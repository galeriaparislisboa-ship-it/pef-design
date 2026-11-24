// PEF Design beta: isolated Google OAuth flow. Not wired into the public worker.
// Required: DB, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_ORIGIN.
// Google Cloud authorized redirect: https://<worker-host>/auth/google/callback
const enc = new TextEncoder();
const random = (n=32) => { const b=crypto.getRandomValues(new Uint8Array(n));return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
const digest = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const cookie=(name,value,age)=>`${name}=${value}; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const callbackUrl=req=>new URL('/auth/google/callback',req.url).toString();
const oauthCookie='pef_google_flow';
const fail=(message,status=400)=>json({error:message},status);
const validConfig=env=>env.DB&&env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.AUTH_COOKIE_KEY;
export async function googleAuth(request,env,issueSession) {
 if(!validConfig(env))return fail('Missing auth configuration',503);
 const u=new URL(request.url);
 if(request.method!=='GET')return fail('Method not allowed',405);
 if(u.pathname==='/auth/google/start'){
  const state=random(),verifier=random(48),nonce=random();
  const challenge=b64url(await crypto.subtle.digest('SHA-256',enc.encode(verifier)));
  // The encrypted cookie binds the callback to the browser that initiated the flow.
  // Set AUTH_COOKIE_KEY to a 32-byte base64url key in Worker secrets.
  if(!env.AUTH_COOKIE_KEY)return fail('Missing AUTH_COOKIE_KEY',503);
  const keyBytes=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode("pef-google:"+env.AUTH_COOKIE_KEY)));
  if(keyBytes.length!==32)return fail('Invalid cookie key',503);
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify({state,verifier,nonce,iat:Date.now(),production:u.searchParams.get("app")==="production"})));
  const packed=b64url(new Uint8Array([...iv,...new Uint8Array(ciphertext)]));
  const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [k,v] of Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callbackUrl(request),response_type:'code',scope:'openid email profile',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}))auth.searchParams.set(k,v);
  return new Response(null,{status:302,headers:{Location:auth.toString(),'Set-Cookie':cookie(oauthCookie,packed,600),'Cache-Control':'no-store'}});
 }
 if(u.pathname!=='/auth/google/callback')return fail('Not found',404);
 const raw=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(oauthCookie+'='))?.slice(oauthCookie.length+1);
 if(!raw||!env.AUTH_COOKIE_KEY)return fail('OAuth session expired',400);
 const cleared=cookie(oauthCookie,'',0);
 try {
  const keyBytes=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode("pef-google:"+env.AUTH_COOKIE_KEY)));
  const bytes=Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt']);
  const flow=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12))));
  if(Date.now()-flow.iat>600000||flow.state!==u.searchParams.get('state')||!u.searchParams.get('code'))return fail('Invalid OAuth state',400);
  const body=new URLSearchParams({code:u.searchParams.get('code'),client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:callbackUrl(request),grant_type:'authorization_code',code_verifier:flow.verifier});
  const exchange=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  if(!exchange.ok){
   const result=await exchange.json().catch(()=>null);
   const messages={invalid_client:'Le secret OAuth configuré dans Cloudflare est refusé par Google.',invalid_grant:'Google a refusé cette autorisation. Relance la connexion depuis PEF.',redirect_uri_mismatch:'L’adresse de retour Cloudflare ne correspond pas au réglage Google.',unauthorized_client:'Ce client OAuth ne peut pas utiliser ce mode de connexion.'};
   const reason=Object.hasOwn(messages,result?.error)?result.error:'exchange_failed';
   return fail(messages[reason]||'Le service Google n’a pas accepté l’échange. Réessaie depuis PEF.',502);
  }
  const tokens=await exchange.json();
  // Google's tokeninfo verifies signature, issuer and expiration server-side.
  const verify=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(tokens.id_token||''));
  if(!verify.ok)return fail('Invalid Google ID token',401);
  const profile=await verify.json();
  if(!['accounts.google.com','https://accounts.google.com'].includes(profile.iss)||profile.aud!==env.GOOGLE_CLIENT_ID||profile.nonce!==flow.nonce||![true,'true'].includes(profile.email_verified)||!profile.sub||!profile.email)return fail('Google identity rejected',401);
  const email=String(profile.email).toLowerCase();
  if(email!=='galeriaparislisboa@gmail.com')return fail('Use the email code for this account',403);
  const account=await env.DB.prepare('SELECT id FROM users WHERE lower(email)=? LIMIT 1').bind(email).first();
  if(!account)return fail('Gallery account unavailable',403);
  const origin=JSON.stringify(flow.production===true?"https://pef-design.vercel.app":"https://pef-design-migration-preview.galeriaparislisboa.workers.dev");
  const payload=JSON.stringify({type:'pef-google-auth',token:await issueSession(email),role:'gallery'});
  const html=`<!doctype html><meta charset="utf-8"><title>PEF sign-in</title><script>if(window.opener){window.opener.postMessage(${payload},${origin});window.close()}else{document.body.textContent='Open PEF Design and try again.'}</script>`;
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",'Set-Cookie':cleared,'Referrer-Policy':'no-referrer'}});
 }catch{return new Response(JSON.stringify({error:'Google sign-in failed'}),{status:400,headers:{'Content-Type':'application/json','Set-Cookie':cleared,'Cache-Control':'no-store'}})}
}
