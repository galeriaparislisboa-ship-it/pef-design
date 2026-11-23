// PEF Design Cloudflare Worker — independent password authentication.
// Deploy only after configuring ADMIN_PASSWORD, GALLERY_PASSWORD, SESSION_SECRET as Worker secrets.
// Bind DB (D1) and MEDIA (R2). No anonymous admin access.
const ORIGINS = new Set(['https://pef-design.vercel.app','https://pef-design-bs4xn2zv3-pef-design.vercel.app','https://pef-design-git-feature-cloudflare-auth-no-sup-8503c8-pef-design.vercel.app','https://pef-design-6y7bxstu7-pef-design.vercel.app']);
const enc = new TextEncoder();
function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unbase64url(s){const b=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(b,c=>c.charCodeAt(0));}
async function sign(secret,data){const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(data))));}
function equal(a,b){const x=enc.encode(a),y=enc.encode(b);let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);return diff===0;}
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});}
function cors(request){const origin=request.headers.get('Origin');const headers={'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS','Vary':'Origin'};if(ORIGINS.has(origin))headers['Access-Control-Allow-Origin']=origin;return headers;}
async function authorize(request,env){const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');const [payload,mac]=token.split('.');if(!payload||!mac||!env.SESSION_SECRET)return null;const expected=await sign(env.SESSION_SECRET,payload);if(!equal(mac,expected))return null;try{const data=JSON.parse(new TextDecoder().decode(unbase64url(payload)));return data.exp>Date.now()&&['admin','gallery'].includes(data.role)?data:null;}catch{return null;}}
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method,headers=cors(request);
  const out=(body,status=200)=>json(body,status,headers);
  if(method==='OPTIONS')return new Response(null,{status:204,headers});
  if(path==='/health'&&method==='GET')return out({service:'pef-design-api',status:'ok'});
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
  if(path==='/api/auth/me'&&method==='GET'){const user=await authorize(request,env);return user?out({role:user.role,email:user.email}):out({error:'Unauthorized'},401);}
  if(path==='/api/text-listings'&&method==='GET'){
   if(!env.DB)return out({error:'Database unavailable'},503);
   try{
    const result=await env.DB.prepare('SELECT id,seller_id,title,description,category,price,city,country,whatsapp,listing_status,negotiable,trade,created_at,photos,video_url,media_order FROM pef_objects WHERE COALESCE(is_hidden,0)=0 ORDER BY created_at DESC LIMIT 100').all();
    const parseArray=(value)=>{if(Array.isArray(value))return value;if(typeof value!=='string')return [];try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[]}catch{return []}};
    const listings=result.results.map(row=>{
     const photos=parseArray(row.photos).filter(url=>typeof url==='string'&&/^https:\/\//.test(url));
     const video=typeof row.video_url==='string'&&(/\/video\/upload\//.test(row.video_url)||/\.(mp4|webm|mov)(\?|$)/i.test(row.video_url))?row.video_url:null;
     const media=photos.map((url,index)=>({type:'photo',url,index}));
     if(video)media.splice(Math.min(1,media.length),0,{type:'video',url:video});
     return {...row,photos,video_url:video,media_order:parseArray(row.media_order),media};
    });
    return out({listings,count:listings.length});
   }
   catch{return out({error:'Unable to load listings'},500);}
  }
  // Gallery metadata editing; media and publishing remain disabled.
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
   const allowed=['title','description','price','city','country','category','whatsapp','listing_status'];
   const keys=Object.keys(input);
   if(!keys.length||keys.some(k=>!allowed.includes(k)))return out({error:'Unsupported field'},400);
   const fields=[],values=[];
   for(const key of keys){
    let value=input[key];
    if(key==='price'){
     if(!/^[0-9]+([.][0-9]{1,2})?$/.test(String(value).trim()))return out({error:'Invalid price'},400);
     value=String(value).trim();
    }else{
     if(typeof value!=='string')return out({error:'Invalid '+key},400);
     value=value.trim();
     if(!value||value.length>(key==='description'?2000:key==='title'?120:160))return out({error:'Invalid '+key},400);
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
  const uploadMatch=path.match(/^\/api\/listings\/([^/]+)\/upload$/);
  if(method==='GET'&&path.startsWith('/media/')){
   if(!env.MEDIA)return out({error:'Media storage unavailable'},503);
   const key=path.slice('/media/'.length);
   if(!/^listings\/[a-zA-Z0-9_-]+\/[a-f0-9-]{36}\.(jpg|png|webp|mp4|webm)$/.test(key))return out({error:'Not found'},404);
   const object=await env.MEDIA.get(key);
   if(!object)return out({error:'Not found'},404);
   return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff',...headers}});
  }
  if((uploadMatch&&method==='POST')||(mediaMatch&&method==='PATCH')){
   const user=await authorize(request,env);
   if(!user)return out({error:'Unauthorized'},401);
   if(!env.DB||!env.MEDIA)return out({error:'Storage unavailable'},503);
   const id=decodeURIComponent((uploadMatch||mediaMatch)[1]);
   if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return out({error:'Invalid listing ID'},400);
   const account=await env.DB.prepare('SELECT id FROM users WHERE lower(email)=? LIMIT 1').bind(user.email.toLowerCase()).first();
   if(!account)return out({error:'Account not found'},403);
   const existing=await env.DB.prepare('SELECT id,seller_id,photos,video_url FROM pef_objects WHERE id=? LIMIT 1').bind(id).first();
   if(!existing)return out({error:'Listing not found'},404);
   if(user.role!=='admin'&&existing.seller_id!==account.id)return out({error:'Forbidden'},403);
   if(uploadMatch){
    const type=request.headers.get('Content-Type')||'';
    const formats={'image/jpeg':['jpg',8*1024*1024],'image/png':['png',8*1024*1024],'image/webp':['webp',8*1024*1024],'video/mp4':['mp4',35*1024*1024],'video/webm':['webm',35*1024*1024]};
    const format=formats[type];
    if(!format)return out({error:'Unsupported media format'},415);
    const length=Number(request.headers.get('Content-Length')||0);
    if(length>format[1])return out({error:'File too large'},413);
    const data=await request.arrayBuffer();
    if(!data.byteLength||data.byteLength>format[1])return out({error:'File too large or empty'},413);
    const bytes=new Uint8Array(data),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP',mp4=String.fromCharCode(...bytes.slice(4,8))==='ftyp',webm=bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163;
    if(!({'image/jpeg':jpg,'image/png':png,'image/webp':webp,'video/mp4':mp4,'video/webm':webm})[type])return out({error:'File content does not match format'},415);
    const key='listings/'+id+'/'+crypto.randomUUID()+'.'+format[0];
    await env.MEDIA.put(key,data,{httpMetadata:{contentType:type}});
    return out({ok:true,url:new URL('/media/'+key,url).toString(),type:type.startsWith('image/')?'photo':'video'});
   }
   const input=await request.json().catch(()=>null);
   if(!input||!Array.isArray(input.photos)||input.photos.length<2||input.photos.length>5)return out({error:'Select 2 to 5 photos'},400);
   const photos=input.photos,video=input.video_url||null;
   if(photos.some(p=>typeof p!=='string'||!p.startsWith('https://'))||new Set(photos).size!==photos.length)return out({error:'Invalid photo URLs'},400);
   if(video!==null&&(typeof video!=='string'||!video.startsWith('https://')))return out({error:'Invalid video URL'},400);
   // New R2 URLs must belong to this listing; existing URLs can be retained.
   const oldPhotos=(()=>{try{const p=JSON.parse(existing.photos||'[]');return Array.isArray(p)?p:[]}catch{return []}})();
   const allowedOld=new Set([...oldPhotos,existing.video_url].filter(Boolean));
   const ownPrefix=new URL('/media/listings/'+id+'/',url).toString();
   if([...photos,...(video?[video]:[])].some(p=>!allowedOld.has(p)&&!p.startsWith(ownPrefix)))return out({error:'Media must belong to this listing'},403);
   try{
    await env.DB.prepare('UPDATE pef_objects SET photos=?,video_url=?,media_order=? WHERE id=? AND seller_id=?').bind(JSON.stringify(photos),video,JSON.stringify(photos.map((p,i)=>({type:'photo',url:p,index:i}))),id,existing.seller_id).run();
    return out({ok:true,photos,video_url:video});
   }catch{return out({error:'Unable to save media'},500);}
  }
  // Protected write endpoints intentionally remain disabled until schema and media mappings are verified.
  if(path.startsWith('/api/admin')||path.startsWith('/api/listings')||path.startsWith('/api/media')){
   const user=await authorize(request,env);if(!user)return out({error:'Unauthorized'},401);
   return out({error:'Publishing not enabled yet'},501);
  }
  return out({error:'Not found'},404);
 }
};
