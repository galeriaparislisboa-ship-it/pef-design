// Add this route in worker.js BEFORE the final protected-write fallback.
// It creates a private draft. Media is uploaded with the existing authenticated
// POST /api/listings/:id/upload endpoint and committed with PATCH /api/listings/:id/media.
// Requires pef_objects schema: id,seller_id,title,description,category,price,city,
// country,whatsapp,listing_status,photos,video_url,media_order,created_at.
// Do not deploy until columns are checked against the live D1 schema.
if(path==='/api/listings'&&method==='POST'){
 const user=await authorize(request,env);
 if(!user)return out({error:'Unauthorized'},401);
 if(!env.DB)return out({error:'Database unavailable'},503);
 const account=await env.DB.prepare('SELECT id FROM users WHERE lower(email)=? LIMIT 1').bind(user.email.toLowerCase()).first();
 if(!account)return out({error:'Account not found'},403);
 const input=await request.json().catch(()=>null);
 if(!input||typeof input!=='object'||Array.isArray(input))return out({error:'Invalid JSON'},400);
 const fields=['title','description','price','category','city','country','whatsapp'];
 if(Object.keys(input).some(k=>!fields.includes(k)))return out({error:'Unsupported field'},400);
 for(const k of fields){
  if(typeof input[k]!=='string'||!input[k].trim())return out({error:'Missing '+k},400);
  if(input[k].length>(k==='description'?2000:k==='title'?120:160))return out({error:'Invalid '+k},400);
 }
 if(!/^\d+(\.\d{1,2})?$/.test(input.price.trim()))return out({error:'Invalid price'},400);
 const id=crypto.randomUUID();
 try{
  await env.DB.prepare("INSERT INTO pef_objects (id,seller_id,title,description,category,price,city,country,whatsapp,listing_status,photos,video_url,media_order,created_at) VALUES (?,?,?,?,?,?,?,?,?,'draft','[]',NULL,'[]',?)")
   .bind(id,account.id,...fields.map(k=>input[k].trim()),new Date().toISOString()).run();
  return out({ok:true,id,status:'draft'},201);
 }catch(e){console.error('PEF create draft:',e?.message);return out({error:'Unable to create draft; verify D1 schema'},500)}
}
// IMPORTANT: existing public GET /api/text-listings must exclude drafts:
// WHERE COALESCE(is_hidden,0)=0 AND listing_status IN ('available','reserved','sold')
// IMPORTANT: PATCH /api/listings/:id/media should switch draft to available only
// when 2–5 photos have been saved, after verifying all media belong to the listing.
