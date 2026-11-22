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
   try{const result=await env.DB.prepare('SELECT id,seller_id,title,description,category,price,city,country,whatsapp,listing_status,negotiable,trade,created_at FROM pef_objects WHERE COALESCE(is_hidden,0)=0 ORDER BY created_at DESC LIMIT 100').all();return out({listings:result.results.map(x=>({...x,media:[]})),count:result.results.length});}
   catch{return out({error:'Unable to load listings'},500);}
  }
  // Protected write endpoints intentionally remain disabled until schema and media mappings are verified.
  if(path.startsWith('/api/admin')||path.startsWith('/api/listings')||path.startsWith('/api/media')){
   const user=await authorize(request,env);if(!user)return out({error:'Unauthorized'},401);
   return out({error:'Publishing not enabled yet'},501);
  }
  return out({error:'Not found'},404);
 }
};
