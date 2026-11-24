const ownerEmail='galeriaparislisboa@gmail.com';
const prefix='/api/gallery/newsletters';
const uuid=/^[0-9a-f-]{36}$/i;
const fonts=new Set(['editorial','modern','classic','mono']);
const schema=`CREATE TABLE IF NOT EXISTS pef_newsletters (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, draft TEXT NOT NULL, published TEXT,
 scheduled TEXT, job_ids TEXT NOT NULL DEFAULT '[]', locked INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

function secureUrl(value){
 try{return typeof value==='string'&&value.length<=2048&&new URL(value).protocol==='https:'}
 catch{return false}
}

function readDraft(value){
 if(!value||typeof value.subject!=='string'||!value.subject.trim()||value.subject.length>120||
    typeof value.intro!=='string'||value.intro.length>1200||!fonts.has(value.font)||
    !Array.isArray(value.pieces)||value.pieces.length>100||
    (value.instagram!==null&&(!Array.isArray(value.instagram)||value.instagram.length>12)))return null;
 const pieces=[];
 for(const piece of value.pieces){
  if(!piece||typeof piece.id!=='string'||piece.id.length>160||typeof piece.title!=='string'||piece.title.length>200||!secureUrl(piece.photos?.[0]))return null;
  pieces.push({id:piece.id,title:piece.title,price:String(piece.price??'').slice(0,32),photos:[piece.photos[0]]});
 }
 const instagram=value.instagram?.map(post=>post&&{
  permalink:post.permalink,image:post.image,
 })??null;
 if(instagram?.some(post=>!post||!secureUrl(post.image)||!secureUrl(post.permalink)||
    !/^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\//i.test(post.permalink)))return null;
 return {subject:value.subject.trim(),intro:value.intro,font:value.font,pieces,instagram};
}

const asRecord=row=>({id:row.id,draft:JSON.parse(row.draft),published:Boolean(row.published),scheduled:row.scheduled,locked:Boolean(row.locked),updatedAt:row.updated_at});

export async function newsletters(request,env,user,out){
 const path=new URL(request.url).pathname;
 const [,id,action]=path.slice(prefix.length).split('/');
 const method=request.method;
 const publicRead=method==='GET'&&action==='public'&&uuid.test(id);
 if(!publicRead&&(user?.role!=='gallery'||user.email!==ownerEmail))return out({error:'Gallery sign-in required.'},403);
 if(!env.DB)return out({error:'Newsletter storage unavailable.'},503);
 const sql=(query,...args)=>{const statement=env.DB.prepare(query);return args.length?statement.bind(...args):statement};
 try{
  await sql(schema).run();
  if(publicRead){
   const row=await sql('SELECT published FROM pef_newsletters WHERE id=? AND published IS NOT NULL',id).first();
   return row?out({draft:JSON.parse(row.published)}):out({error:'Newsletter unavailable.'},404);
  }
  if(!id&&method==='GET'){
   const {results}=await sql('SELECT * FROM pef_newsletters WHERE owner=? ORDER BY updated_at DESC',ownerEmail).all();
   return out({newsletters:results.map(asRecord)});
  }
  if(method!=='POST')return out({error:'Method not allowed.'},405);
  const input=await request.json().catch(()=>null);
  if(!id){
   const draft=readDraft(input?.draft);
   if(!draft)return out({error:'Enter a valid subject and newsletter content.'},400);
   const newId=uuid.test(input?.id??'')?input.id:crypto.randomUUID();
   const row=await sql('INSERT INTO pef_newsletters (id,owner,draft) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET draft=excluded.draft,updated_at=CURRENT_TIMESTAMP WHERE pef_newsletters.owner=excluded.owner RETURNING *',newId,ownerEmail,JSON.stringify(draft)).first();
   return row?out({newsletter:asRecord(row)}):out({error:'Newsletter unavailable.'},404);
  }
  if(!uuid.test(id))return out({error:'Newsletter unavailable.'},404);
  const row=await sql('SELECT * FROM pef_newsletters WHERE id=? AND owner=?',id,ownerEmail).first();
  if(!row)return out({error:'Newsletter unavailable.'},404);
  if(action==='publish'||action==='unpublish'){
   const updated=await sql(`UPDATE pef_newsletters SET published=${action==='publish'?'draft':'NULL'},updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner=? RETURNING *`,id,ownerEmail).first();
   return out({newsletter:asRecord(updated)});
  }
  if(action==='delete'){
   const removed=await sql('DELETE FROM pef_newsletters WHERE id=? AND owner=? AND locked=0 AND (scheduled IS NULL OR scheduled<=?) RETURNING id',id,ownerEmail,new Date().toISOString()).first();
   return removed?out({deleted:true}):out({error:'Cancel the scheduled delivery before deleting this newsletter.'},409);
  }
  if(action!=='schedule'&&action!=='cancel')return out({error:'Unknown newsletter action.'},404);
  if(!env.RESEND_API_KEY)return out({error:'Email delivery is unavailable.'},503);
  const now=Date.now();
  const delivery=new Date(input?.scheduled??'');
  let recipients=[];
  if(action==='schedule'){
   if(!(delivery.getTime()>now+120000&&delivery.getTime()<now+30*86400000))return out({error:'Choose a time between 2 minutes and 30 days from now.'},400);
   if(typeof input.html!=='string'||!input.html||input.html.length>250000)return out({error:'Email content is unavailable or too long.'},400);
   await sql('CREATE TABLE IF NOT EXISTS pef_newsletter_contacts (owner TEXT PRIMARY KEY, contacts TEXT NOT NULL)').run();
   const contacts=await sql('SELECT contacts FROM pef_newsletter_contacts WHERE owner=?',ownerEmail).first();
   recipients=contacts?JSON.parse(contacts.contacts):[];
   if(!recipients.length)return out({error:'Save at least one address in the private mailing list.'},400);
  }
  const locked=await sql(`UPDATE pef_newsletters SET locked=? WHERE id=? AND owner=? AND locked=0 AND ${action==='schedule'?'(scheduled IS NULL OR scheduled<=?)':'scheduled>?'} RETURNING *`,now,id,ownerEmail,new Date(now).toISOString()).first();
  if(!locked)return out({error:'This newsletter already has a delivery in progress or has no active schedule to cancel.'},409);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const send=async (path,body,key,retry=true)=>{
   let response;
   try{
    response=await fetch('https://api.resend.com/emails'+path,{method:'POST',headers:{
     Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{}),
    },body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   }catch(error){
    if(key&&retry)return send(path,body,key,false);
    throw error;
   }
   if((response.status===429||(key&&response.status>=500))&&retry){await pause(1100);return send(path,body,key,false)}
   if(!response.ok)throw Error('Email provider HTTP '+response.status);
   return response.json();
  };
  const update=(scheduled,jobs)=>sql('UPDATE pef_newsletters SET scheduled=?,job_ids=?,locked=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner=? RETURNING *',scheduled,JSON.stringify(jobs),id,ownerEmail).first();
  const cancel=async jobs=>{
   const pending=[];
   for(const [index,job] of jobs.entries()){
    if(index)await pause(550);
    try{await send('/'+encodeURIComponent(job)+'/cancel',{})}catch{pending.push(job)}
   }
   return pending;
  };
  if(action==='cancel'){
   const pending=await cancel(JSON.parse(locked.job_ids));
   const updated=await update(pending.length?locked.scheduled:null,pending);
   return pending.length?out({error:'Some scheduled batches could not be canceled.',newsletter:asRecord(updated)},502):out({newsletter:asRecord(updated)});
  }
  const jobs=[];
  const iso=delivery.toISOString();
  const convention=`<p style="font:12px Arial,sans-serif;color:#555">To unsubscribe, <a href="mailto:${ownerEmail}?subject=Unsubscribe">reply to the gallery</a>.</p>`;
  try{
   const draft=JSON.parse(locked.draft);
   for(let start=0;start<recipients.length;start+=49){
    if(start)await pause(550);
    const bcc=recipients.slice(start,start+49);
    const envelope={from:'Galerie Paris–Lisboa <newsletter@auth.galeriaparislisboa.com>',to:[ownerEmail],bcc,reply_to:ownerEmail,subject:draft.subject,html:input.html+convention,scheduled_at:iso};
    const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(envelope)))),b=>b.toString(16).padStart(2,'0')).join('');
    const {id:job}=await send('',envelope,id+'/'+locked.locked+'/'+start+'/'+key);
    if(!job)throw Error('Missing delivery reference');
    jobs.push(job);
    await sql('UPDATE pef_newsletters SET scheduled=?,job_ids=? WHERE id=? AND owner=?',iso,JSON.stringify(jobs),id,ownerEmail).run();
   }
   return out({newsletter:asRecord(await update(iso,jobs)),recipients:recipients.length});
  }catch(error){
   const pending=await cancel(jobs);
   const updated=await update(pending.length?iso:null,pending);
   return out({error:pending.length?'Delivery was only partly scheduled. Cancel the remaining batches before retrying.':`Delivery is not scheduled. ${error.message}.`,newsletter:asRecord(updated)},502);
  }
 }catch{return out({error:'Newsletter service unavailable.'},503)}
}
