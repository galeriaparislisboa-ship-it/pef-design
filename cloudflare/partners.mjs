import {visibleListing, initializeModeration} from './moderation.mjs';

const idPattern = /^[a-f0-9-]{36}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isPhone = value => /^\+?[1-9][0-9\s().-]{6,19}$/.test(value);
const text = (form, name, limit) => String(form.get(name) ?? '').trim().slice(0, limit);
const query = (db, sql, ...values) => db.prepare(sql).bind(...values);
const rows = async (db, sql, ...values) => (await query(db, sql, ...values).all()).results;
const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
const clientOrigin = env => env.PEF_PARTNER_APP_ORIGIN || 'https://pef-design.vercel.app';

function marketplaceUrl(value,profile=false) {
  let url;
  try { url=new URL(value); } catch { return null; }
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  const host=url.hostname.replace(/^www\./,'');
  if(host==='etsy.com'){
    const match=profile
      ?url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?shop\/([a-z0-9]+)\/?$/i)
      :url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?listing\/(\d+)(?:\/[^/]+)?\/?$/i);
    if(match)return {platform:'etsy',url:'https://www.etsy.com/'+(profile?'shop/':'listing/')+match[1]};
  }
  if(host==='vinted.pt'){
    const match=url.pathname.match(profile?/^\/member\/(\d+)(?:-[^/]+)?\/?$/:/^\/items\/(\d+)(?:-[^/]+)?\/?$/);
    if(match)return {platform:'vinted',url:'https://www.vinted.pt/'+(profile?'member/':'items/')+match[1]};
  }
  return null;
}
export const marketplaceListingUrl = value => marketplaceUrl(value)?.url || null;

export async function findPartnerInvitation(db, token, email) {
  if (!db || !tokenPattern.test(token || '')) return null;
  await initializeModeration(db);
  return query(db, `SELECT id,name,email FROM pef_partner_pages
    WHERE invite_hash=? AND invite_until>? AND owner_id IS NULL AND email=?`, await sha(token), Date.now(), email).first();
}

// This is only called after verification of the invited email by email code or Google.
export async function claimPartnerPage(db, token, email) {
  const invitation = await findPartnerInvitation(db, token, email);
  if (!invitation) return null;
  const event = crypto.randomUUID(), newId = crypto.randomUUID(), hash = await sha(token);
  const writes = [
    query(db, `INSERT INTO users(id,email,display_name)
      SELECT ?,email,name FROM pef_partner_pages WHERE id=? AND invite_hash=? AND invite_until>?
        AND owner_id IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE lower(email)=?)`,
    newId, invitation.id, hash, Date.now(), email),
    query(db, `UPDATE pef_partner_pages SET owner_id=(SELECT id FROM users WHERE lower(email)=? LIMIT 1),
      claim_event=?, invite_hash=NULL, invite_until=NULL, preview_hash=NULL, preview_until=NULL
      WHERE id=? AND email=? AND invite_hash=? AND invite_until>? AND owner_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM pef_archived_accounts a JOIN users u ON u.id=a.user_id WHERE lower(u.email)=?)
      AND NOT EXISTS (SELECT 1 FROM pef_archived_accounts WHERE user_id=pef_partner_pages.id)`,
    email, event, invitation.id, email, hash, Date.now(), email),
    query(db, `UPDATE pef_objects SET seller_id=(SELECT owner_id FROM pef_partner_pages WHERE claim_event=?)
      WHERE seller_id=? AND EXISTS(SELECT 1 FROM pef_partner_pages WHERE claim_event=?)
      AND id IN (SELECT id FROM pef_partner_listings WHERE page_id=?)`, event, invitation.id, event, invitation.id),
  ];
  const result = await db.batch(writes);
  return result[1].meta.changes ? await query(db, 'SELECT owner_id AS id FROM pef_partner_pages WHERE claim_event=?', event).first() : null;
}

async function findPreview(db, token) {
  if (!tokenPattern.test(token || '')) return null;
  const digest=await sha(token),now=Date.now();
  return query(db, `SELECT id,name,city,country,whatsapp,(SELECT logo FROM pef_partner_presentation WHERE page_id=pef_partner_pages.id) AS logo FROM pef_partner_pages
    WHERE ((preview_hash=? AND preview_until>?) OR (invite_hash=? AND invite_until>?)) AND owner_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM pef_archived_accounts WHERE user_id=pef_partner_pages.id)`,
    digest,now,digest,now).first();
}

async function pageListings(db, id) {
  return (await rows(db, `SELECT o.id,o.title,o.description,o.price,o.category,o.city,o.country,o.whatsapp,o.photos,o.is_hidden,
    l.source_url,l.published_at FROM pef_objects o JOIN pef_partner_listings l ON l.id=o.id
    WHERE l.page_id=? ORDER BY o.created_at DESC,o.id`, id)).map(row=>({...row,photos:JSON.parse(row.photos)}));
}

export async function partnerMediaAccess(request, env, user, id) {
  await initializeModeration(env.DB);
  const published = await query(env.DB, `SELECT 1 FROM pef_objects JOIN pef_partner_listings l ON l.id=pef_objects.id
    WHERE pef_objects.id=? AND l.published_at IS NOT NULL AND ${visibleListing}`, id).first();
  if (published || user?.role === 'admin') return true;
  const owner = user && await query(env.DB, `SELECT 1 FROM pef_objects o JOIN users u ON u.id=o.seller_id
    WHERE o.id=? AND lower(u.email)=?`, id,user.email.toLowerCase()).first();
  if (owner) return true;
  const preview = await findPreview(env.DB, request.headers.get('Authorization')?.replace(/^Preview /,''));
  return Boolean(preview && await query(env.DB, 'SELECT 1 FROM pef_partner_listings WHERE id=? AND page_id=?', id, preview.id).first());
}

async function saveDraft(request,env,page,out) {
  const length = Number(request.headers.get('Content-Length'));
  if (length > 6 * 1024 * 1024) return out({error:'The photos exceed the draft upload limit'},413);
  const form = await request.formData().catch(()=>null);
  if (!form) return out({error:'Invalid draft'},400);
  const title = text(form,'title',60), description = text(form,'description',80), category = text(form,'category',60);
  const price = text(form,'price',20), source = text(form,'source_url',1500);
  const photos = form.getAll('photo');
  if (!title || (price && (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price)<=0)) ||
      photos.length<2 || photos.length>5 || photos.some(file=>typeof file==='string'||file.type!=='image/jpeg'||file.size<3||file.size>1024*1024))
    return out({error:'Enter a title, a valid price if known, and 2 to 5 compressed photos'},400);
  if (source) {
    let url;
    try { url=new URL(source); } catch { return out({error:'Invalid source link'},400); }
    if (url.protocol!=='https:' || url.username || url.password) return out({error:'Invalid source link'},400);
  }
  const id = 'partner_'+crypto.randomUUID();
  const origin = new URL(request.url).origin;
  const stored = [];
  try {
    for (const photo of photos) {
      const content = await photo.arrayBuffer();
      const signature = new Uint8Array(content,0,3);
      if (signature[0]!==255||signature[1]!==216||signature[2]!==255) throw Error('Invalid JPEG');
      const key = 'listings/'+id+'/'+crypto.randomUUID()+'.jpg';
      await env.MEDIA.put(key,content,{httpMetadata:{contentType:'image/jpeg'}});
      stored.push(key);
    }
    const urls = stored.map(key=>origin+'/media/'+key);
    const result = await env.DB.batch([
      query(env.DB,`INSERT INTO pef_objects(id,seller_id,title,description,price,category,city,country,whatsapp,photos,
        media_order,video_url,trim_end,is_hidden,created_at)
        SELECT ?,id,?,?,?,?,city,country,?,?,?,'',0,1,CURRENT_TIMESTAMP FROM pef_partner_pages WHERE id=? AND owner_id IS NULL`,
      id,title,description,price,category,page.whatsapp,JSON.stringify(urls),JSON.stringify(urls.map((url,index)=>({type:'photo',url,index}))),page.id),
      query(env.DB,'INSERT INTO pef_partner_listings(id,page_id,source_url) SELECT id,?,? FROM pef_objects WHERE id=?',page.id,source,id),
    ]);
    if (result[0].meta.changes) return out({id},201);
  } catch (error) {
    // After an ambiguous write failure, retain files when the listing exists or D1 cannot be checked.
    const saved = await query(env.DB,'SELECT id FROM pef_objects WHERE id=?',id).first().catch(()=>undefined);
    if (saved) return out({id},201);
    if (saved===null && stored.length) await env.MEDIA.delete(stored).catch(()=>{});
    throw error;
  }
  await env.MEDIA.delete(stored).catch(()=>{});
  return out({error:'The seller has already taken over this page'},409);
}

async function publish(db,page,listing,consent,actor,out) {
  const item = await query(db,`SELECT o.title,o.description,o.category,o.price,o.whatsapp,o.city,o.country,o.photos,o.is_hidden,l.published_at,l.source_url
    FROM pef_objects o JOIN pef_partner_listings l ON l.id=o.id WHERE o.id=? AND l.page_id=?`,listing,page.id).first();
  if (!item) return out({error:'Listing unavailable'},404);
  if (item.published_at) return out({error:'This listing has already been published. Use moderation to restore a hidden listing.'},409);
  if (![item.title,item.description,item.category,item.city,item.country].every(value=>value?.trim())||
      item.category==='All'||!Number.isFinite(Number(item.price))||Number(item.price)<=0||(!marketplaceListingUrl(item.source_url)&&!isPhone(item.whatsapp))||
      JSON.parse(item.photos).length<2) return out({error:'Complete the description, category, price, location, WhatsApp and photos before publishing'},400);
  const result = await db.batch([
    query(db,`UPDATE pef_partner_listings SET consent=?,published_at=CURRENT_TIMESTAMP
      WHERE id=? AND page_id=? AND published_at IS NULL
      AND EXISTS(SELECT 1 FROM pef_partner_pages p JOIN pef_objects o ON o.id=pef_partner_listings.id
        WHERE p.id=? AND COALESCE(p.owner_id,'')=? AND NOT EXISTS(SELECT 1 FROM pef_archived_accounts WHERE user_id=o.seller_id))`,
    consent,listing,page.id,page.id,page.owner_id||''),
    query(db,`UPDATE pef_objects SET is_hidden=0,created_at=CURRENT_TIMESTAMP WHERE id=? AND changes()=1`,listing),
    query(db,`INSERT INTO pef_moderation_log(id,actor,target,action,note) SELECT ?,?,?,'partner_publish',? WHERE changes()=1`,
    crypto.randomUUID(),actor,listing,consent),
  ]);
  return result[0].meta.changes ? out({ok:true}) : out({error:'Listing or ownership changed. Refresh and try again.'},409);
}

export async function partners(request,env,user,out) {
  const path = new URL(request.url).pathname, method = request.method, db = env.DB;
  const admin = path.startsWith('/api/admin/');
  if (admin && user?.role!=='admin') return out({error:'Administrator sign-in required'},user?403:401);
  if (!db) return out({error:'Database unavailable'},503);
  try {
    await initializeModeration(db);
    if (path.startsWith('/api/partners/feed-logo/') && method==='GET') {
      const page=path.split('/').at(-1);
      if(!idPattern.test(page))return out({error:'Logo unavailable'},404);
      const row=await query(db,`SELECT s.logo FROM pef_partner_presentation s WHERE s.page_id=? AND s.logo IS NOT NULL
        AND EXISTS(SELECT 1 FROM pef_partner_listings l JOIN pef_objects ON pef_objects.id=l.id
          WHERE l.page_id=s.page_id AND l.published_at IS NOT NULL AND ${visibleListing})`,page).first();
      if(!row)return out({error:'Logo unavailable'},404);
      const png=Uint8Array.from(atob(row.logo.slice('data:image/png;base64,'.length)),character=>character.charCodeAt(0));
      return new Response(png,{headers:{'Content-Type':'image/png','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
    }
    if (path.startsWith('/api/partners/public-profile/') && method==='GET') {
      const owner=path.split('/').at(-1);
      if(!idPattern.test(owner))return out({error:'Seller page unavailable'},404);
      const profile=await query(db,`SELECT s.logo,d.bio,d.website,d.instagram,p.whatsapp FROM pef_partner_presentation s JOIN pef_partner_pages p ON p.id=s.page_id LEFT JOIN pef_partner_details d ON d.page_id=p.id
        WHERE p.owner_id=? AND s.public=1 AND NOT EXISTS(SELECT 1 FROM pef_archived_accounts WHERE user_id=p.owner_id)
        AND EXISTS(SELECT 1 FROM pef_partner_listings l JOIN pef_objects o ON o.id=l.id
          WHERE l.page_id=p.id AND l.published_at IS NOT NULL AND o.is_hidden=0) ORDER BY p.id LIMIT 1`,owner).first();
      return profile ? out(profile) : out({error:'Seller page unavailable'},404);
    }
    if (path==='/api/partners/preview' && method==='GET') {
      const page = await findPreview(db,request.headers.get('Authorization')?.replace(/^Preview /,''));
      if (!page) return out({error:'This private link has expired or been replaced'},404);
      const listings = await pageListings(db,page.id);
      const details=await query(db,'SELECT bio,website,instagram FROM pef_partner_details WHERE page_id=?',page.id).first();
      return out({page:{...page,...details},listings:listings.map(({id,title,description,price,photos,is_hidden})=>({id,title,description,price,photos,is_hidden}))});
    }
    if (path==='/api/admin/partner-pages' && method==='GET') {
      return out({pages:await rows(db,`SELECT id,name,city,country,email,whatsapp,owner_id,preview_until,invite_until
        FROM pef_partner_pages p WHERE NOT EXISTS(SELECT 1 FROM pef_deleted_accounts d WHERE d.user_id=p.id OR d.user_id=p.owner_id) ORDER BY name,id`)});
    }
    if (path==='/api/admin/partner-pages' && method==='POST') {
      const data = await request.json().catch(()=>null);
      const fields = ['name','city','country','email','whatsapp'].map(key=>typeof data?.[key]==='string'?data[key].trim():'');
      const [name,city,country,rawEmail,whatsapp] = fields, email=rawEmail.toLowerCase();
      const platform=data?.platform||'';
      const profile=platform&&marketplaceUrl(data?.seller_url,true);
      if(platform&&profile?.platform!==platform)return out({error:'Enter a seller profile URL for the selected marketplace'},400);
      if (!name||!city||!country||name.length>120||city.length>60||country.length>60||email.length>254||
          ((!platform||email)&&(!emailPattern.test(email)||email.endsWith('@provisional.invalid')))||(whatsapp&&!isPhone(whatsapp)))
        return out({error:'Enter the name, location and valid contact details'},400);
      const id = crypto.randomUUID();
      const writes = [
        query(db,'INSERT INTO users(id,email,display_name) VALUES(?,?,?)',id,id+'@provisional.invalid',name),
        query(db,'INSERT INTO pef_partner_pages(id,name,city,country,email,whatsapp) VALUES (?,?,?,?,?,?)',id,name,city,country,email,whatsapp),
      ];
      if(profile){
        const existing=`SELECT d.page_id FROM pef_partner_details d
          WHERE lower(d.website)=lower(?) AND NOT EXISTS(SELECT 1 FROM pef_deleted_accounts WHERE user_id=d.page_id)`;
        await db.batch([
          query(db,`INSERT INTO users(id,email,display_name) SELECT ?,?,? WHERE NOT EXISTS(${existing})`,id,id+'@provisional.invalid',name,profile.url),
          query(db,'INSERT INTO pef_partner_pages(id,name,city,country,email,whatsapp) SELECT ?,?,?,?,?,? WHERE changes()=1',id,name,city,country,email||id+'@provisional.invalid',whatsapp),
          query(db,"INSERT INTO pef_partner_details(page_id,bio,website,instagram) SELECT ?,'',?,'' WHERE changes()=1",id,profile.url),
        ]);
        const seller=await query(db,existing+' ORDER BY page_id LIMIT 1',profile.url).first();
        return seller?out({id:seller.page_id},seller.page_id===id?201:200):out({error:'Seller page unavailable'},409);
      }
      await db.batch(writes);
      return out({id},201);
    }
    if (path==='/api/partners/pages' && method==='GET') {
      if (!user) return out({error:'Sign in to manage your page'},401);
      return out({pages:await rows(db,`SELECT p.id,p.name,p.city,p.country,p.whatsapp,p.owner_id
        FROM pef_partner_pages p JOIN users u ON u.id=p.owner_id WHERE lower(u.email)=? ORDER BY p.name`,user.email.toLowerCase())});
    }
    const prefix=admin?'/api/admin/partner-pages':'/api/partners/pages';
    if (!path.startsWith(prefix+'/')&&!admin) return out({error:'Not found'},404);
    if (!user) return out({error:'Sign in to manage this page'},401);
    const [id,action,listing,...rest] = path.slice(prefix.length+1).split('/');
    if (rest.length||!idPattern.test(id)) return out({error:'Not found'},404);
    const page = await query(db,`SELECT p.*,s.logo,s.public,d.bio,d.website,d.instagram FROM pef_partner_pages p LEFT JOIN users u ON u.id=p.owner_id LEFT JOIN pef_partner_presentation s ON s.page_id=p.id LEFT JOIN pef_partner_details d ON d.page_id=p.id
      WHERE p.id=? AND (?=1 OR lower(u.email)=?) AND NOT EXISTS(SELECT 1 FROM pef_deleted_accounts d WHERE d.user_id=p.id OR d.user_id=p.owner_id)`,id,Number(admin),user.email.toLowerCase()).first();
    if (!page) return out({error:'Seller page not found'},404);
    if (!action && method==='GET') return out({page:{id,name:page.name,city:page.city,country:page.country,whatsapp:page.whatsapp,owner_id:page.owner_id,logo:page.logo,bio:page.bio,website:page.website,instagram:page.instagram,public:Boolean(page.public)},listings:await pageListings(db,id)});
    if (method!=='POST') return out({error:'Method not allowed'},405);
    if (action==='details' && !listing) {
      if(admin&&page.owner_id)return out({error:'The seller manages these details'},409);
      const data=await request.json().catch(()=>null);
      if(!data||!['bio','website','instagram','whatsapp'].every(key=>typeof data[key]==='string'))
        return out({error:'Invalid seller details'},400);
      const bio=data.bio.trim(), whatsapp=data.whatsapp.trim(), instagram=data.instagram.trim().replace(/^@/,'');
      let website=data.website.trim();
      if(bio.length>600||website.length>500||(instagram&&!/^[a-z0-9_.]{1,30}$/i.test(instagram))||(whatsapp&&!isPhone(whatsapp)))
        return out({error:'Check the description, Instagram username or WhatsApp number'},400);
      if(website){
        try{
          const parsed=new URL(website);
          if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error();
          website=parsed.href;
        }catch{return out({error:'Enter a website URL starting with https:// or http://'},400)}
      }
      const owner=page.owner_id||'';
      const result=await db.batch([
        query(db,`INSERT INTO pef_partner_details(page_id,bio,website,instagram)
          SELECT id,?,?,? FROM pef_partner_pages WHERE id=? AND COALESCE(owner_id,'')=?
          ON CONFLICT(page_id) DO UPDATE SET bio=excluded.bio,website=excluded.website,instagram=excluded.instagram`,bio,website,instagram,id,owner),
        query(db,"UPDATE pef_partner_pages SET whatsapp=? WHERE id=? AND COALESCE(owner_id,'')=?",whatsapp,id,owner),
      ]);
      return result[0].meta.changes ? out({ok:true}) : out({error:'Page ownership changed'},409);
    }
    if (action==='presentation' && !listing) {
      const data=await request.json().catch(()=>null);
      if(Object.hasOwn(data||{},'logo')){
        const logo=data.logo;
        if(logo!==null&&(typeof logo!=='string'||logo.length>180000||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+=*$/.test(logo)))
          return out({error:'Choose a valid logo'},400);
        await query(db,`INSERT INTO pef_partner_presentation(page_id,logo) VALUES(?,?)
          ON CONFLICT(page_id) DO UPDATE SET logo=excluded.logo`,id,logo).run();
        return out({ok:true});
      }
      if(admin||!page.owner_id||typeof data?.public!=='boolean')return out({error:'The seller must confirm the visibility of this page'},403);
      await query(db,`INSERT INTO pef_partner_presentation(page_id,public) VALUES(?,?)
        ON CONFLICT(page_id) DO UPDATE SET public=excluded.public`,id,Number(data.public)).run();
      return out({ok:true});
    }
    if (action==='profile' && !listing && !admin) {
      const data=await request.json().catch(()=>null);
      const [name,city,country,whatsapp]=['name','city','country','whatsapp'].map(key=>typeof data?.[key]==='string'?data[key].trim():'');
      if(!name||!city||!country||name.length>120||city.length>60||country.length>60||!isPhone(whatsapp))
        return out({error:'Enter the name, location and confirmed WhatsApp number'},400);
      await db.batch([
        query(db,'UPDATE pef_partner_pages SET name=?,city=?,country=?,whatsapp=? WHERE id=? AND owner_id=?',
          name,city,country,whatsapp,id,page.owner_id),
        query(db,`UPDATE pef_objects SET city=?,country=?,whatsapp=? WHERE seller_id=?
          AND id IN(SELECT id FROM pef_partner_listings WHERE page_id=?)`,city,country,whatsapp,page.owner_id,id),
      ]);
      return out({ok:true});
    }
    if (admin && page.owner_id && action!=='publish') return out({error:'The seller has taken over this page'},409);
    if (admin && action==='drafts' && !listing && env.MEDIA) return await saveDraft(request,env,page,out);
    if (action==='publish' && /^partner_[a-f0-9-]{36}$/.test(listing||'')) {
      const data = await request.json().catch(()=>null);
      const consent = typeof data?.consent==='string'?data.consent.trim():'';
      if (admin&&(!consent||consent.length>500)) return out({error:'Record the seller’s permission to publish this listing'},400);
      return await publish(db,page,listing,admin?consent:'Published by the seller',user.email,out);
    }
    if (admin && !listing && (action==='preview'||action==='invite')) {
      const token = newToken(), preview = action==='preview';
      const now = Date.now(), expires = now+(preview?7:3)*86400000;
      const digest = await sha(token);
      const url = new URL('/seller-onboarding.html',clientOrigin(env));
      url.hash=(preview?'preview=':'invite=')+token;
      if (preview) {
        const saved = await query(db,'UPDATE pef_partner_pages SET preview_hash=?,preview_until=? WHERE id=? AND owner_id IS NULL',digest,expires,id).run();
        return saved.meta.changes?out({url:url.href,expires}):out({error:'Page has been claimed'},409);
      }
      if (page.email.endsWith('@provisional.invalid')) return out({error:'A seller email is required before sending an invitation'},400);
      if (!env.RESEND_API_KEY) return out({error:'Invitation email delivery is unavailable'},503);
      const saved = await query(db,`UPDATE pef_partner_pages SET invite_hash=?,invite_until=?
        WHERE id=? AND owner_id IS NULL AND (invite_until IS NULL OR invite_until<?)`,digest,expires,id,expires-60000).run();
      if (!saved.meta.changes) return out({error:'An invitation was just sent or this page has been claimed'},409);
      const delivery = await fetch('https://api.resend.com/emails',{method:'POST',headers:{
        Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'pef-partner/'+digest
      },body:JSON.stringify({
        from:'PEF Design <login@auth.galeriaparislisboa.com>',to:[page.email],subject:'Take over your seller page on PEF Design',
        text:'A seller page for '+page.name+' is ready on PEF Design. Use this personal link within 3 days to verify your email and take over your page:\n\n'+url.href
      })}).catch(()=>null);
      if (!delivery?.ok) {
        await query(db,'UPDATE pef_partner_pages SET invite_hash=?,invite_until=? WHERE id=? AND invite_hash=? AND owner_id IS NULL',
          page.invite_hash,page.invite_until,id,digest).run();
        return out({error:'Could not send the invitation. Check email delivery and try again.'},502);
      }
      return out({expires});
    }
    return out({error:'Not found'},404);
  } catch (error) {
    console.error('Partner pages:',error.message);
    return out({error:'Seller-page action unavailable'},503);
  }
}
