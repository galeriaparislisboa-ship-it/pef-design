import {partners,findPartnerInvitation,claimPartnerPage,partnerMediaAccess} from './partners.mjs';
import {newsletters} from "./newsletters.mjs";
import {initializeModeration, moderation, visibleListing, listingLikeCount} from "./moderation.mjs";
import {googleAuth} from "./auth-google.js";
import {issueCode,consumeCode} from "./auth-email-code.mjs";
// PEF Design Cloudflare Worker — independent password authentication.
// Deploy only after configuring ADMIN_PASSWORD, GALLERY_PASSWORD, SESSION_SECRET as Worker secrets.
// Bind DB (D1) and MEDIA (R2). No anonymous admin access.
const ORIGINS = new Set(['https://pef-design.vercel.app','https://pef-design-bs4xn2zv3-pef-design.vercel.app','https://pef-design-git-feature-cloudflare-auth-no-sup-8503c8-pef-design.vercel.app','https://pef-design-6y7bxstu7-pef-design.vercel.app']);
const enc = new TextEncoder();
const signInLifetime = 7 * 24 * 60 * 60;
function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unbase64url(s){const b=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(b,c=>c.charCodeAt(0));}
async function sign(secret,data){const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(data))));}
function equal(a,b){const x=enc.encode(a),y=enc.encode(b);let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);return diff===0;}
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});}
function cors(request){return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'};}
async function verifySession(request,env){const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');const [payload,mac]=token.split('.');if(!payload||!mac||!env.SESSION_SECRET)return null;const expected=await sign(env.SESSION_SECRET,payload);if(!equal(mac,expected))return null;try{const data=JSON.parse(new TextDecoder().decode(unbase64url(payload)));return typeof data.email==='string'&&data.exp>Date.now()&&['admin','gallery','seller'].includes(data.role)?data:null;}catch{return null;}}
async function authorize(request,env){
 const user=await verifySession(request,env);
 if(!user||user.role==='admin'||!env.DB)return user;
 await initializeModeration(env.DB);
 const account=await env.DB.prepare(`SELECT u.id FROM users u WHERE lower(u.email)=? AND (? IS NULL OR u.id=?)
   AND NOT EXISTS (SELECT 1 FROM pef_archived_accounts a WHERE a.user_id=u.id)`).bind(user.email.toLowerCase(),user.userId??null,user.userId??null).first();
 return account?user:null;
}
function validPostId(value){return typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)}
const parseArray=(value)=>{if(Array.isArray(value))return value;if(typeof value!=='string')return [];try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[]}catch{return []}};
function videoPosition(order){
 const first=parseArray(order)[0];
 return first?.type==='video'||first==='video'?1:2;
}
function orderedMedia(photos,video,position){
 const media=photos.map((url,index)=>({type:'photo',url,index}));
 if(video)media.splice(position-1,0,{type:'video',url:video});
 return media;
}
function listingWithMedia(row){
 const photos=parseArray(row.photos).filter(url=>typeof url==='string'&&/^https:\/\//.test(url));
 const video=typeof row.video_url==='string'&&(/\/video\/upload\//.test(row.video_url)||/\.(mp4|webm|mov)(\?|$)/i.test(row.video_url))?row.video_url:null;
 const media=orderedMedia(photos,video,videoPosition(row.media_order));
 return {...row,photos,video_url:video,media_order:parseArray(row.media_order),media};
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method,headers=cors(request);
  const out=(body,status=200)=>json(body,status,headers);
  if(method==='OPTIONS')return new Response(null,{status:204,headers});
  if(['/api/admin/moderation','/api/reports','/api/verification'].includes(path)){
   return moderation(request,env.DB,await verifySession(request,env),out);
  }
  if(path.startsWith('/api/admin/partner-pages')||path.startsWith('/api/partners/')){
   return partners(request,env,path==='/api/partners/preview'?null:await authorize(request,env),out);
  }
  if(path==='/health'&&method==='GET')return out({service:'pef-design-api',status:'ok'});
  async function createSession(email,role,userId){
   const payload=base64url(enc.encode(JSON.stringify({role,email,userId,exp:Date.now()+signInLifetime*1000})));
   return payload+'.'+await sign(env.SESSION_SECRET,payload);
  }
  if(path==='/auth/google/start'||path==='/auth/google/callback'){
   return googleAuth(request,env,createSession,claimPartnerPage);
  }
  if(method==='POST'&&(path==='/api/auth/code/send'||path==='/api/auth/code/verify')){
   if(!env.DB||!env.SESSION_SECRET||!env.RESEND_API_KEY)return out({error:'Sign-in unavailable'},503);
   const body=await request.json().catch(()=>null);
   const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
   const role=email==='ndondina@muchimuchi.fr'?'admin':email==='galeriaparislisboa@gmail.com'?'gallery':'seller';
   try{
    const invite=typeof body?.invite==='string'?body.invite:'';
    const invitation=invite&&role==='seller'?await findPartnerInvitation(env.DB,invite,email):null;
    if(invite&&!invitation)return out({error:'This invitation is unavailable or does not match the invited email'},400);
    let account=email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&await env.DB.prepare('SELECT id FROM users WHERE lower(email)=? LIMIT 1').bind(email).first();
    if(path.endsWith('/send')){
     if(account||invitation)await issueCode(env.DB,'pef-otp:'+env.SESSION_SECRET+invite,email,async(to,code)=>{
      const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:'PEF Design <login@auth.galeriaparislisboa.com>',to:[to],subject:'Your PEF Design sign-in code',text:'Your sign-in code is '+code+'. It expires in 10 minutes.',html:"<html lang=\"en\"><body style=\"margin:0;background:#111\"><table role=\"presentation\" width=\"100%\" bgcolor=\"#111111\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"padding:32px 16px\"><table role=\"presentation\" width=\"100%\" bgcolor=\"#1a1a1a\" style=\"max-width:460px;border:1px solid #333;border-radius:18px\"><tr><td style=\"padding:28px;color:#fff;font-family:Arial,sans-serif\"><p style=\"margin:0;color:#a8cff1;font-weight:bold\">PEF Design</p><h1 style=\"font-size:26px\">Your sign-in code</h1><p style=\"color:#ccc\">Enter this code in PEF Design to continue.</p><p style=\"text-align:center;background:#a8cff1;color:#111;font-size:32px;font-weight:bold;letter-spacing:4px;border-radius:12px;padding:14px\">CODE_SLOT</p><p style=\"color:#ccc;font-size:14px;line-height:1.5\">This code expires in 10 minutes. If you didn’t request it, you can ignore this email.</p></td></tr></table></td></tr></table></body></html>".replace('CODE_SLOT',code)})});
      if(!res.ok)throw Error('Email delivery failed');
     });
     return out({ok:true});
    }
    if((!account&&!invitation)||!await consumeCode(env.DB,'pef-otp:'+env.SESSION_SECRET+invite,email,body?.code))return out({error:'Invalid or expired code'},401);
    if(invitation)account=await claimPartnerPage(env.DB,invite,email);
    if(!account)return out({error:'The page was already claimed or the invitation expired'},409);
    return out({token:await createSession(email,role,account.id),role,email,expires_in:signInLifetime});
   }catch{return out({error:'Sign-in temporarily unavailable'},503)}
  }
  if(path==='/api/auth/login'&&method==='POST'){
   if(!env.ADMIN_PASSWORD||!env.GALLERY_PASSWORD||!env.SESSION_SECRET)return out({error:'Auth secrets not configured'},503);
   const body=await request.json().catch(()=>({}));
   const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
   let role=null;
   if(email==='ndondina@muchimuchi.fr'&&equal(password,env.ADMIN_PASSWORD))role='admin';
   if(email==='galeriaparislisboa@gmail.com'&&equal(password,env.GALLERY_PASSWORD))role='gallery';
   if(!role)return out({error:'Invalid credentials'},401);
   const payload=base64url(enc.encode(JSON.stringify({role,email,exp:Date.now()+8*60*60*1000})));
   return out({token:payload+'.'+await sign(env.SESSION_SECRET,payload),role,email,expires_in:28800});
  }
  if(path==='/api/auth/me'&&method==='GET'){const user=await authorize(request,env);return user?out({role:user.role,email:user.email,userId:user.userId}):out({error:'Unauthorized'},401);}
  if(path==='/api/gallery/newsletters'||path.startsWith('/api/gallery/newsletters/')){
   const user=path.endsWith('/public')?null:await authorize(request,env);
   return newsletters(request,env,user,out);
  }
  if(path==='/api/gallery/newsletter-contacts'){
   const user=await authorize(request,env);
   if(user?.role!=='gallery'||user.email!=='galeriaparislisboa@gmail.com')return out({error:'Forbidden'},403);
   if(method!=='GET'&&method!=='PATCH')return out({error:'Method not allowed'},405);
   if(!env.DB)return out({error:'Address book unavailable'},503);
   await env.DB.prepare('CREATE TABLE IF NOT EXISTS pef_newsletter_contacts (owner TEXT PRIMARY KEY, contacts TEXT NOT NULL)').run();
   if(method==='GET'){
    const row=await env.DB.prepare('SELECT contacts FROM pef_newsletter_contacts WHERE owner=?').bind(user.email).first();
    return out({contacts:row?JSON.parse(row.contacts):[]});
   }
   const input=await request.json().catch(()=>null);
   const emailPattern=/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
   if(!Array.isArray(input?.contacts)||input.contacts.length>500||input.contacts.some(email=>typeof email!=='string'||email.length>254||!emailPattern.test(email)))return out({error:'Enter up to 500 valid email addresses'},400);
   const contacts=[...new Set(input.contacts.map(email=>email.toLowerCase()))];
   await env.DB.prepare('INSERT INTO pef_newsletter_contacts (owner,contacts) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET contacts=excluded.contacts').bind(user.email,JSON.stringify(contacts)).run();
   return out({contacts});
  }
  if(path==='/api/gallery/profile'){
   if(!env.MEDIA)return out({error:'Storage unavailable'},503);
   const object=await env.MEDIA.get('gallery/paris-lisboa/profile.json');
   const old=object?await object.json():{};
   const options=['tour','selection','quote','sourcing','viewing'];
   if(method==='GET'){
    const {bio='',avatar='',hidden=false,services={}}=old;
    await initializeModeration(env.DB);
    const archived=await env.DB.prepare("SELECT 1 FROM pef_archived_accounts a JOIN users u ON a.user_id=u.id WHERE lower(u.email)='galeriaparislisboa@gmail.com'").first();
    return out(archived?{hidden:true}:{bio,avatar,hidden,services});
   }
   if(method!=='PATCH')return out({error:'Method not allowed'},405);
   const user=await authorize(request,env);
   if(user?.role!=='gallery'||user.email!=='galeriaparislisboa@gmail.com')return out({error:'Forbidden'},403);
   const input=await request.json().catch(()=>null);
   if(!input||typeof input.bio!=='string'||[...input.bio].length>120||typeof input.hidden!=='boolean'||!options.every(key=>typeof input.services?.[key]==='boolean'))return out({error:'Invalid profile settings'},400);
   let avatar=old.avatar||'';
   if(input.avatar){
    if(typeof input.avatar!=='string'||input.avatar.length>350000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(input.avatar))return out({error:'Invalid profile photo'},400);
    const binary=atob(input.avatar.split(',')[1]);
    if(binary.charCodeAt(0)!==255||binary.charCodeAt(1)!==216)return out({error:'Invalid profile photo'},400);
    avatar=input.avatar;
   }
   const result={bio:input.bio.trim(),avatar,hidden:input.hidden,services:Object.fromEntries(options.map(key=>[key,input.services[key]])),deletionRequestedAt:old.deletionRequestedAt||null};
   if(input.requestDeletion===true)result.deletionRequestedAt=new Date().toISOString();
   await env.MEDIA.put('gallery/paris-lisboa/profile.json',JSON.stringify(result));
   return out({ok:true,deletionRequestedAt:result.deletionRequestedAt});
  }
  if(path==='/api/likes'&&(method==='GET'||method==='PATCH')){
   if(!env.DB)return out({error:'Database unavailable'},503);
   try{
    const user=await authorize(request,env);
    if(!user)return out({error:'Unauthorized'},401);
    await initializeModeration(env.DB);
    const account=await env.DB.prepare('SELECT id FROM users WHERE lower(email)=?').bind(user.email.toLowerCase()).first();
    if(!account)return out({error:'Account not found'},403);
    const likedIds=env.DB.prepare('SELECT listing_id FROM pef_listing_likes WHERE user_id=?').bind(account.id);
    if(method==='GET'){
     const {results}=await likedIds.all();
     return out({ids:results.map(row=>row.listing_id)});
    }
    const {changes}=await request.json().catch(()=>null)||{};
    if(!Array.isArray(changes)||!changes.length||changes.length>30||changes.some(change=>
     !change||typeof change.id!=='string'||!change.id.length||change.id.length>150||typeof change.liked!=='boolean'
    ))return out({error:'Invalid likes'},400);
    const changesById=new Map(changes.map(change=>[change.id,change.liked]));
    const ids=[...changesById.keys()];
    const writes=[...changesById].map(([id,liked])=>liked
     ?env.DB.prepare(`INSERT OR IGNORE INTO pef_listing_likes(listing_id,user_id)
       SELECT id,? FROM pef_objects WHERE id=? AND ${visibleListing}`).bind(account.id,id)
     :env.DB.prepare('DELETE FROM pef_listing_likes WHERE listing_id=? AND user_id=?').bind(id,account.id));
    const counts=env.DB.prepare(`SELECT id,${listingLikeCount} FROM pef_objects WHERE id IN (${ids.map(()=>'?').join(',')}) AND ${visibleListing}`).bind(...ids);
    const results=await env.DB.batch([...writes,likedIds,counts]);
    return out({ids:results.at(-2).results.map(row=>row.listing_id),counts:results.at(-1).results});
   }catch(error){
    console.error('Likes unavailable',error.message);
    return out({error:'Unable to synchronize likes'},500);
   }
  }
  if(path==='/api/text-listings'&&method==='GET'){
   if(!env.DB)return out({error:'Database unavailable'},503);
   try{
    await initializeModeration(env.DB);
    const result=await env.DB.prepare(`SELECT id,seller_id,title,description,category,price,city,country,whatsapp,listing_status,negotiable,trade,promotion_price,object_date,views,${listingLikeCount},whatsapp_clicks,created_at,photos,video_url,media_order,trim_start,trim_end,
     (SELECT badge FROM pef_seller_badges WHERE seller_id=pef_objects.seller_id) AS seller_badge,
     COALESCE((SELECT p.name FROM pef_partner_listings l JOIN pef_partner_pages p ON p.id=l.page_id WHERE l.id=pef_objects.id),
       (SELECT display_name FROM pef_seller_badges WHERE seller_id=pef_objects.seller_id AND badge<>'none')) AS seller_name,
     (SELECT CASE WHEN p.owner_id IS NULL OR COALESCE(s.public,0)=0 THEN 1 ELSE 0 END
       FROM pef_partner_listings l JOIN pef_partner_pages p ON p.id=l.page_id
       LEFT JOIN pef_partner_presentation s ON s.page_id=p.id WHERE l.id=pef_objects.id) AS seller_profile_hidden,
     (SELECT l.page_id FROM pef_partner_listings l JOIN pef_partner_presentation p ON p.page_id=l.page_id
       WHERE l.id=pef_objects.id AND p.logo IS NOT NULL) AS seller_logo_page
     FROM pef_objects WHERE ${visibleListing} ORDER BY created_at DESC LIMIT 100`).all();
    const listings=result.results.map(listingWithMedia);
    return out({listings,count:listings.length});
   }
   catch{return out({error:'Unable to load listings'},500);}
  }
  if(path==='/api/listings/mine'&&method==='GET'){
   const user=await authorize(request,env);
   if(!user)return out({error:'Unauthorized'},401);
   const account=await env.DB.prepare('SELECT id FROM users WHERE lower(email)=? LIMIT 1').bind(user.email.toLowerCase()).first();
   if(!account)return out({error:'Account not found'},403);
   await initializeModeration(env.DB);
   const {results}=await env.DB.prepare(`SELECT id,seller_id,title,description,category,price,city,country,whatsapp,listing_status,negotiable,trade,promotion_price,object_date,views,${listingLikeCount},whatsapp_clicks,created_at,photos,video_url,media_order,is_hidden FROM pef_objects WHERE seller_id=? ORDER BY created_at DESC`).bind(account.id).all();
   return out({listings:results.map(listingWithMedia)});
  }
  if(path==='/api/listings'&&method==='POST'){
   const user=await authorize(request,env);
   if(!user)return out({error:'Sign in to publish'},401);
   if(!env.DB||!env.MEDIA)return out({error:'Storage unavailable'},503);
   const account=await env.DB.prepare('SELECT u.id,b.badge FROM users u LEFT JOIN pef_seller_badges b ON b.seller_id=u.id WHERE lower(u.email)=? LIMIT 1').bind(user.email.toLowerCase()).first();
   if(!account)return out({error:'Account not found'},403);
   const input=await request.json().catch(()=>null);
   if(!validPostId(input?.draftId))return out({error:'Invalid draft identifier'},400);
   const id=account.id+'_'+input.draftId;
   const old=await env.DB.prepare('SELECT id,is_hidden FROM pef_objects WHERE id=? AND seller_id=?').bind(id,account.id).first();
   if(old)return out({id,published:!old.is_hidden});
   const {title,description,category,price,city,country,whatsapp,photos,video_url='',object_date='',negotiable=false,trade=false}=input;
   const required=[title,description,category,city,country,whatsapp];
   if(required.some(value=>typeof value!=='string'||!value.trim())||title.length>60||description.length>80||[category,city,country].some(value=>value.length>60)||
     !/^\d+(?:\.\d{1,2})?$/.test(String(price))||Number(price)<=0||!/^\+?[0-9\s().-]{7,20}$/.test(whatsapp)||
     typeof negotiable!=='boolean'||typeof trade!=='boolean'||typeof object_date!=='string'||(object_date&&!/^c\. \d{4}$/.test(object_date)))return out({error:'Check the listing details and contact number'},400);
   if(!Array.isArray(photos)||photos.length<2||photos.length>5||new Set(photos).size!==photos.length)return out({error:'Select 2 to 5 photos'},400);
   const base='/media/listings/'+id+'/';
   function mediaKey(value,extension){
    if(typeof value!=='string')return null;
    try{const link=new URL(value);const name=link.pathname.slice(base.length);
     return link.origin===url.origin&&link.pathname.startsWith(base)&&!link.search&&!link.hash&&extension.test(name)?link.pathname.slice('/media/'.length):null;
    }catch{return null}
   }
   const photoKeys=photos.map(photo=>mediaKey(photo,/^[a-f0-9-]{36}\.(jpg|png|webp)$/));
   const videoKey=video_url?mediaKey(video_url,/^[a-f0-9-]{36}\.(mp4|webm|mov)$/):null;
   if(photoKeys.some(key=>!key)||(video_url&&!videoKey))return out({error:'Upload media for this draft before publishing'},400);
   const trimStart=Number(input.trim_start??0);
   if(!Number.isFinite(trimStart)||trimStart<0||trimStart>86400)return out({error:'Invalid video selection'},400);
   const ordered=orderedMedia(photos,video_url,input.video_position===1?1:2);
   const migratedGallery=account.badge==null&&user.role==='gallery'&&user.email.toLowerCase()==='galeriaparislisboa@gmail.com'&&account.id==='f81528f3-3c3c-4590-9ee9-543f950b6884';
   const hidden=migratedGallery||['verified','professional','gallery'].includes(account.badge)?0:1;
   try{
    const objects=await Promise.all([...photoKeys,...(videoKey?[videoKey]:[])].map(key=>env.MEDIA.head(key)));
    if(objects.some(object=>!object))return out({error:'One or more media files are missing'},400);
    const row=await env.DB.prepare(`INSERT INTO pef_objects
      (id,seller_id,title,description,category,price,city,country,whatsapp,photos,video_url,media_order,trim_start,trim_end,object_date,negotiable,trade,is_hidden,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP
      WHERE NOT EXISTS (SELECT 1 FROM pef_archived_accounts WHERE user_id=?)
      ON CONFLICT(id) DO NOTHING RETURNING id,is_hidden`)
     .bind(id,account.id,title.trim(),description.trim(),category.trim(),String(price),city.trim(),country.trim(),whatsapp.trim(),JSON.stringify(photos),video_url,JSON.stringify(ordered),videoKey?trimStart:0,videoKey?trimStart+10:0,object_date,Number(negotiable),Number(trade),hidden,account.id).first();
    const saved=row||await env.DB.prepare('SELECT id,is_hidden FROM pef_objects WHERE id=? AND seller_id=?').bind(id,account.id).first();
    return saved?out({id,published:!saved.is_hidden},row?201:200):out({error:'Account unavailable'},403);
   }catch(error){console.error('Listing creation failed',error.message);return out({error:'Unable to publish this listing'},500);}
  }
  // Gallery metadata editing.
  if(/^\/api\/listings\/[^/]+$/.test(path)&&method==='PATCH'){
   const user=await authorize(request,env);
   if(!user)return out({error:'Unauthorized'},401);
   if(!env.DB)return out({error:'Database unavailable'},503);
   const account=await env.DB.prepare('SELECT id FROM users WHERE lower(email)=? LIMIT 1').bind(user.email.toLowerCase()).first();
   if(!account)return out({error:'Account not found'},403);
   const id=decodeURIComponent(path.split('/').pop());
   const existing=await env.DB.prepare('SELECT id,seller_id FROM pef_objects WHERE id=? LIMIT 1').bind(id).first();
   if(!existing)return out({error:'Listing not found'},404);
   if(user.role!=='admin'&&existing.seller_id!==account.id)return out({error:'Forbidden'},403);
   const input=await request.json().catch(()=>null);
   if(!input||typeof input!=='object'||Array.isArray(input))return out({error:'Invalid JSON'},400);
   const allowed=['title','description','price','city','country','category','whatsapp','listing_status','promotion_price','object_date','negotiable','trade'];
   const keys=Object.keys(input);
   if(!keys.length||keys.some(k=>!allowed.includes(k)))return out({error:'Unsupported field'},400);
   const fields=[],values=[];
   for(const key of keys){
    let value=input[key];
    if(['negotiable','trade'].includes(key)){if(typeof value!=='boolean')return out({error:'Invalid option'},400);value=value?1:0;}else if(key==='promotion_price'&&value===null){value=null;}else if(key==='price'||key==='promotion_price'){
if (!/^\d+(\.\d{1,2})?$/.test(String(value).trim())) return out({error:'Invalid price'},400);
value=String(value).trim();
}else{
     if(typeof value!=='string')return out({error:'Invalid '+key},400);
     value=value.trim();
     if((!value&&!['description','object_date'].includes(key))||value.length>(key==='description'?2000:key==='title'?120:160))return out({error:'Invalid '+key},400);
     if(key==='listing_status'&&!['available','sold','reserved'].includes(value))return out({error:'Invalid status'},400);
    }
    fields.push(key+'=?');values.push(value);
   }
   try{
    await env.DB.prepare('UPDATE pef_objects SET '+fields.join(',')+' WHERE id=? AND seller_id=?').bind(...values,id,existing.seller_id).run();
    return out({ok:true,id,updated:keys});
   }catch{return out({error:'Unable to update listing'},500);}
  }
  // R2 media: authenticated upload, per-listing ownership and atomic metadata save.
  const mediaMatch=path.match(/^\/api\/listings\/([^/]+)\/media$/);
  const stagedMatch=path.match(/^\/api\/listings\/stage\/([^/]+)$/);
  const uploadMatch=path.match(/^\/api\/listings\/([^/]+)\/upload$/);
  if((method==='GET'||method==='HEAD')&&path.startsWith('/media/')){
   if(!env.MEDIA)return out({error:'Media storage unavailable'},503);
   const key=path.slice('/media/'.length);
   if(!/^listings\/[a-zA-Z0-9_-]+\/[a-f0-9-]{36}\.(jpg|png|webp|mp4|webm|mov)$/.test(key))return out({error:'Not found'},404);
   const managedId=key.split('/')[1];
   const managed=managedId.startsWith('partner_');
   if(managed&&(!env.DB||!await partnerMediaAccess(request,env,await authorize(request,env),managedId)))return out({error:'Not found'},404);
   const range=request.headers.get('Range');
   const metadata=range||method==='HEAD'?await env.MEDIA.head(key):null;
   if((range||method==='HEAD')&&!metadata)return out({error:'Not found'},404);
   let offset=0,length=metadata?.size,status=200;
   if(range&&method==='GET'){
    const match=range.match(/^bytes=(\d*)-(\d*)$/);
    if(match&&(match[1]||match[2])){
     const size=metadata.size;
     offset=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
     const end=match[1]&&match[2]?Math.min(size-1,Number(match[2])):size-1;
     if(offset>=size||offset>end)return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+size}});
     length=end-offset+1;status=206;
    }
   }
   const object=method==='HEAD'?metadata:await env.MEDIA.get(key,status===206?{range:{offset,length}}:undefined);
   if(!object)return out({error:'Not found'},404);
   const mediaHeaders={...headers,'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Cache-Control':managed?'private, no-store':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Length':String(status===206?length:object.size)};
   if(status===206)mediaHeaders['Content-Range']='bytes '+offset+'-'+(offset+length-1)+'/'+metadata.size;
   return new Response(method==='HEAD'?null:object.body,{status,headers:mediaHeaders});
  }
  if(((uploadMatch||stagedMatch)&&method==='POST')||(mediaMatch&&method==='PATCH')){
   const user=await authorize(request,env);
   if(!user)return out({error:'Unauthorized'},401);
   if(!env.DB||!env.MEDIA)return out({error:'Storage unavailable'},503);
   const account=await env.DB.prepare('SELECT id FROM users WHERE lower(email)=? LIMIT 1').bind(user.email.toLowerCase()).first();
   if(!account)return out({error:'Account not found'},403);
   if(stagedMatch&&!validPostId(stagedMatch[1]))return out({error:'Invalid draft identifier'},400);
   const id=stagedMatch?account.id+'_'+stagedMatch[1]:decodeURIComponent((uploadMatch||mediaMatch)[1]);
   const existing=stagedMatch?{seller_id:account.id}:await env.DB.prepare('SELECT id,seller_id,photos,video_url,media_order FROM pef_objects WHERE id=? LIMIT 1').bind(id).first();
   if(!existing)return out({error:'Listing not found'},404);
   if(user.role!=='admin'&&existing.seller_id!==account.id)return out({error:'Forbidden'},403);
   if(uploadMatch||stagedMatch){
    const type=request.headers.get('Content-Type')||'';
    const formats={'image/jpeg':['jpg',8*1024*1024],'image/png':['png',8*1024*1024],'image/webp':['webp',8*1024*1024],'video/mp4':['mp4',35*1024*1024],'video/quicktime':['mov',35*1024*1024],'video/webm':['webm',35*1024*1024]};
    const format=formats[type];
    if(!format)return out({error:'Unsupported media format'},415);
    const length=Number(request.headers.get('Content-Length')||0);
    if(length>format[1])return out({error:'File too large'},413);
    const data=await request.arrayBuffer();
    if(!data.byteLength||data.byteLength>format[1])return out({error:'File too large or empty'},413);
    const bytes=new Uint8Array(data),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP',mp4=String.fromCharCode(...bytes.slice(4,8))==='ftyp',webm=bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163;
    if(!({'image/jpeg':jpg,'image/png':png,'image/webp':webp,'video/mp4':mp4,'video/quicktime':mp4,'video/webm':webm})[type])return out({error:'File content does not match format'},415);
    const key='listings/'+id+'/'+crypto.randomUUID()+'.'+format[0];
    await env.MEDIA.put(key,data,{httpMetadata:{contentType:type}});
    return out({ok:true,url:new URL('/media/'+key,url).toString(),type:type.startsWith('image/')?'photo':'video'});
   }
   const input=await request.json().catch(()=>null);
   if(!input||!Array.isArray(input.photos)||input.photos.length<2||input.photos.length>5)return out({error:'Select 2 to 5 photos'},400);
   const photos=input.photos,video=input.video_url||'';
   if(photos.some(p=>typeof p!=='string'||!p.startsWith('https://'))||new Set(photos).size!==photos.length)return out({error:'Invalid photo URLs'},400);
if(video && (typeof video!=='string'||!video.startsWith('https://'))) return out({error:'Invalid video URL'},400);   // New R2 URLs must belong to this listing; existing URLs can be retained.
   const oldPhotos=(()=>{try{return JSON.parse(existing.photos||'[]')}catch{return []}})();
   const allowedOld=new Set([...oldPhotos,existing.video_url].filter(Boolean));
   const ownPrefix=new URL('/media/listings/'+id+'/',url).toString();
   if([...photos,...(video?[video]:[])].some(p=>!allowedOld.has(p)&&!p.startsWith(ownPrefix)))return out({error:'Media must belong to this listing'},403);
   try{
    const position=input.video_position??videoPosition(existing.media_order);
    const media_order=orderedMedia(photos,video,position===1?1:2);
    await env.DB.prepare('UPDATE pef_objects SET photos=?,video_url=?,media_order=? WHERE id=? AND seller_id=?').bind(JSON.stringify(photos),video,JSON.stringify(media_order),id,existing.seller_id).run();
    return out({ok:true,photos,video_url:video,media_order});
}catch(error){
  console.error('PEF media save error:', error?.message, error?.stack);
  return out({error:'Unable to save media'},500);
}  }
  // Protected write endpoints intentionally remain disabled until schema and media mappings are verified.
  if(path.startsWith('/api/admin')||path.startsWith('/api/listings')||path.startsWith('/api/media')){
   const user=await authorize(request,env);if(!user)return out({error:'Unauthorized'},401);
   return out({error:'Publishing not enabled yet'},501);
  }
  return out({error:'Not found'},404);
 }
};
