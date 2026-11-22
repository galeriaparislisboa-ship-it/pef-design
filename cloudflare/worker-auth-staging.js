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
function cors(request){const origin=request.headers.get('Origin');const headers={'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Vary':'Origin'};if(ORIGINS.has(origin))headers['Access-Control-Allow-Origin']=origin;return headers;}
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
  // Gallery editing: deliberately limited to metadata; media uploads and publishing remain disabled.
  if(path.match(/^\\/api\\/listings\\/[a-zA-Z0-9-]+$/)&&method==='PATCH'){
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
    if(key==='price'){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100000000)return out({error:'Invalid price'},400);}
    else {if(typeof value!=='string')return out({error:'Invalid '+key},400);value=value.trim();
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
  // Protected write endpoints intentionally remain disabled until schema and media mappings are verified.
  if(path.startsWith('/api/admin')||path.startsWith('/api/listings')||path.startsWith('/api/media')){
   const user=await authorize(request,env);if(!user)return out({error:'Unauthorized'},401);
   return out({error:'Publishing not enabled yet'},501);
  }
  return out({error:'Not found'},404);
 }
};
