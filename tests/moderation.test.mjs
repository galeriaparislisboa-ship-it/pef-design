import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker from '../cloudflare/worker.js';

test('Cloudflare moderation preserves data and enforces visibility and roles', async () => {
 const db = new DatabaseSync(':memory:');
 db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE,display_name TEXT);
  CREATE TABLE pef_objects (id TEXT PRIMARY KEY,seller_id TEXT,title TEXT,description TEXT,
   category TEXT,price TEXT,city TEXT,country TEXT,whatsapp TEXT,listing_status TEXT,promotion_price TEXT,
   object_date TEXT,negotiable INTEGER,trade INTEGER,views INTEGER,likes INTEGER,whatsapp_clicks INTEGER,
   created_at TEXT,photos TEXT,video_url TEXT,media_order TEXT,is_hidden INTEGER,trim_start REAL,trim_end REAL);
  INSERT INTO users VALUES ('admin','ndondina@muchimuchi.fr','Admin'),
   ('seller','galeriaparislisboa@gmail.com','Gallery'),('buyer','buyer@example.test','Buyer');
  INSERT INTO pef_objects(id,seller_id,title,photos) VALUES ('object','seller','Design piece','[]'),('second','seller','Other piece','[]');
 `);
 const env = {
  SESSION_SECRET:'local-test-key',
  DB:{
   prepare(sql){
    const statement=db.prepare(sql);
    const bind=(...args)=>({
     all:async()=>({results:statement.all(...args)}),
     first:async()=>statement.get(...args)||null,
     run:async()=>({meta:statement.run(...args)}),
     batchResult:async()=>statement.columns().length?{results:statement.all(...args)}:{meta:statement.run(...args)},
    });
    return {...bind(),bind};
   },
   async batch(statements){
    db.exec('BEGIN');
    try{
     const result=[];
     for(const statement of statements)result.push(await statement.batchResult());
     db.exec('COMMIT');
     return result;
    }catch(error){db.exec('ROLLBACK');throw error}
   },
  },
 };
 async function session(email,role){
  const payload=Buffer.from(JSON.stringify({email,role,exp:Date.now()+60000})).toString('base64url');
  const {createHmac}=await import('node:crypto');
  return payload+'.'+createHmac('sha256',env.SESSION_SECRET).update(payload).digest('base64url');
 }
 const admin=await session('ndondina@muchimuchi.fr','admin');
 const seller=await session('galeriaparislisboa@gmail.com','gallery');
 const buyer=await session('buyer@example.test','seller');
 const dashboard='/api/admin/moderation';
 async function call(path,token,method='GET',body){
  return worker.fetch(new Request('https://test.example'+path,{method,headers:token?{Authorization:'Bearer '+token}:{},body:body?JSON.stringify(body):undefined}),env);
 }
 const action=(id,action)=>call(dashboard,admin,'PATCH',{id,action,note:'Test decision'});
 const data=async()=>await (await call(dashboard,admin)).json();
 const feed=async()=>await (await call('/api/text-listings')).json();
 assert.equal((await call(dashboard)).status,401);
 assert.equal((await call(dashboard,seller)).status,403);
 assert.equal((await data()).accounts.find(row=>row.id==='seller').gallery,1);
 assert.equal((await feed()).length,undefined);
 assert.equal((await feed()).count,2);
 db.prepare('UPDATE pef_objects SET likes=? WHERE id=?').run(3,'object');
 const setLike=(token,id,liked)=>call('/api/likes',token,'PATCH',{changes:[{id,liked}]});
 assert.equal((await setLike(undefined,'object',true)).status,401);
 for(let i=0;i<2;i++){
  const result=await setLike(buyer,'object',true);
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{ids:['object'],counts:[{id:'object',likes:4}]});
 }
 assert.deepEqual(await (await call('/api/likes',buyer)).json(),{ids:['object']});
 assert.deepEqual(await (await call('/api/likes',seller)).json(),{ids:[]});
 assert.deepEqual(await (await setLike(seller,'object',true)).json(),{ids:['object'],counts:[{id:'object',likes:5}]});
 assert.equal((await feed()).listings.find(row=>row.id==='object').likes,5);
 assert.deepEqual(await (await setLike(buyer,'object',false)).json(),{ids:[],counts:[{id:'object',likes:4}]});
 assert.deepEqual(await (await setLike(buyer,'missing',true)).json(),{ids:[],counts:[]});
 assert.equal((await call('/api/reports',buyer,'POST',{id:'object',reason:'Spam',details:'test report'})).status,201);
 assert.equal((await call('/api/reports',buyer,'POST',{id:'object',reason:'Spam',details:'duplicate'})).status,409);
 const report=(await data()).reports[0];
 assert.equal(report.status,'pending');
 assert.equal((await action('object','hide')).status,200);
 assert.deepEqual((await feed()).listings.map(x=>x.id),['second']);
 assert.deepEqual(await (await setLike(buyer,'object',true)).json(),{ids:[],counts:[]});
 assert.equal((await action(report.id,'resolve')).status,200);
 assert.equal((await data()).reports[0].status,'resolved');
 assert.equal((await action(report.id,'reopen')).status,200);
 assert.equal((await data()).reports[0].status,'pending');
 assert.equal((await action('admin','archive')).status,403);
 assert.equal((await action('seller','archive')).status,200);
 assert.equal((await call('/api/auth/me',seller)).status,401);
 assert.equal((await feed()).count,0);
 assert.equal((await action('seller','restore')).status,200);
 assert.deepEqual((await feed()).listings.map(x=>x.id),['second']);
 assert.equal((await action('object','show')).status,200);
 assert.equal((await feed()).count,2);
 assert.equal((await call('/api/verification',seller,'POST',{display_name:'Galerie',business_name:'',website:'',country:'PT',details:''})).status,200);
 const application=(await data()).requests[0];
 assert.equal((await action(application.id,'approve')).status,200);
 assert.equal((await action(application.id,'approve')).status,409);
 assert.equal((await feed()).listings[0].seller_badge,'verified');
 assert.equal((await action(application.id,'revoke')).status,200);
 assert.equal((await feed()).listings[0].seller_badge,'none');
 assert.equal((await data()).history.length,8);

 // Provisional seller lifecycle exercises the same D1 rows, routes and media gate as production.
 const files=new Map();
 env.MEDIA={
  put:async (key,body,{httpMetadata})=>files.set(key,{body,httpMetadata,size:body.byteLength}),
  get:async key=>files.get(key)||null,
  head:async key=>files.get(key)||null,
  delete:async keys=>keys.forEach(key=>files.delete(key)),
 };
 db.exec(`CREATE TABLE auth_email_codes (id TEXT PRIMARY KEY,email TEXT NOT NULL,code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,attempts INTEGER DEFAULT 0,consumed_at TEXT,created_at TEXT)`);
 env.RESEND_API_KEY='test-mail-key';
 const emails=[];
 const fetchBefore=globalThis.fetch;
 globalThis.fetch=async (url,options)=>{
  assert.equal(url,'https://api.resend.com/emails');
  emails.push(JSON.parse(options.body));
  return new Response(null,{status:200});
 };
 try{
  const partners='/api/admin/partner-pages';
  const profile={name:'Partner Studio',city:'Lisbon',country:'Portugal',email:'partner@example.test',whatsapp:'+351910000000'};
  assert.equal((await call(partners,buyer,'POST',profile)).status,403);
  const created=await call(partners,admin,'POST',profile);
  assert.equal(created.status,201);
  const {id:pageId}=await created.json();
  const path=partners+'/'+pageId;
  async function draft(title,pagePath=path,source='https://www.vinted.pt/items/10-example'){
   const form=new FormData();
   for(const [key,value] of Object.entries({title,description:'A design object',price:'110',category:'Design',source_url:source}))form.set(key,value);
   for(let i=0;i<2;i++)form.append('photo',new Blob([Uint8Array.of(255,216,255,i)],{type:'image/jpeg'}),'test.jpg');
   const response=await worker.fetch(new Request('https://test.example'+pagePath+'/drafts',{method:'POST',headers:{Authorization:'Bearer '+admin},body:form}),env);
   assert.equal(response.status,201,await response.clone().text());
   return (await response.json()).id;
  }
  const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  assert.equal((await call(path+'/presentation',admin,'POST',{logo})).status,200);
  assert.equal((await call(path+'/presentation',admin,'POST',{public:true})).status,403);
  const sellerDetails={bio:'Independent bookshop in Lisbon',website:'https://example.test/',instagram:'@test.books',whatsapp:profile.whatsapp};
  assert.equal((await call(path+'/details',admin,'POST',sellerDetails)).status,200);
  assert.equal((await call(path+'/details',admin,'POST',{...sellerDetails,website:'javascript:alert(1)'})).status,400);
  const publicId=await draft('First listing'), privateId=await draft('Second listing');
  const privateResponse=await call(path+'/preview',admin,'POST');
  assert.equal(privateResponse.status,200);
  const previewUrl=new URL((await privateResponse.json()).url);
  const previewToken=new URLSearchParams(previewUrl.hash.slice(1)).get('preview');
  const preview=async token=>worker.fetch(new Request('https://test.example/api/partners/preview',{headers:{Authorization:'Preview '+token}}),env);
  assert.equal((await preview('bad')).status,404);
  const previewData=await (await preview(previewToken)).json();
  assert.equal(previewData.listings.length,2);
  assert.equal(previewData.page.email,undefined);
  assert.equal(previewData.page.logo,logo);
  assert.equal(previewData.page.bio,sellerDetails.bio);
  assert.equal(previewData.page.instagram,'test.books');
  const media=previewData.listings.find(row=>row.id===publicId).photos[0];
  assert.equal((await worker.fetch(new Request(media),env)).status,404);
  assert.equal((await worker.fetch(new Request(media,{headers:{Authorization:'Preview '+previewToken}}),env)).status,200);
  assert.equal((await action(publicId,'show')).status,409);
  assert.equal((await call(path+'/publish/'+publicId,admin,'POST',{})).status,400);
  assert.equal((await call(path+'/publish/'+publicId,admin,'POST',{consent:'Seller gave permission by email'})).status,200);
  const before=(await feed()).listings.find(row=>row.id===publicId);
  assert.equal(before.source_url,'https://www.vinted.pt/items/10');
  const etsyProfile={name:'Etsy Studio',city:'Lisbon',country:'Portugal',platform:'etsy',
   seller_url:'https://www.etsy.com/fr/shop/EtsyStudio?ref=test'};
  const etsyCreated=await call(partners,admin,'POST',etsyProfile);
  assert.equal(etsyCreated.status,201,await etsyCreated.clone().text());
  const {id:etsyId}=await etsyCreated.json();
  const duplicate=await call(partners,admin,'POST',{...etsyProfile,seller_url:'https://etsy.com/shop/etsystudio/'});
  assert.equal(duplicate.status,200);
  assert.equal((await duplicate.json()).id,etsyId);
  const etsyPath=partners+'/'+etsyId;
  const lampId=await draft('Orange lamp',etsyPath,'https://www.etsy.com/fr/listing/4608930616/lampe-orange?ref=test');
  assert.equal((await call(etsyPath+'/publish/'+lampId,admin,'POST',{consent:'Seller confirmed permission'})).status,200);
  const lamp=(await feed()).listings.find(row=>row.id===lampId);
  assert.equal(lamp.source_url,'https://www.etsy.com/listing/4608930616');
  assert.equal(lamp.whatsapp,'');
  assert.equal(lamp.seller_profile_hidden,1);
  assert.equal(before.seller_name,profile.name);
  assert.equal(before.seller_id,pageId);
  assert.equal(before.seller_profile_hidden,1);
  assert.equal(before.seller_logo_page,pageId);
  const feedLogo=await call('/api/partners/feed-logo/'+pageId);
  assert.equal(feedLogo.status,200);
  assert.equal(feedLogo.headers.get('Content-Type'),'image/png');
  assert.equal((await feed()).listings.some(row=>row.id===privateId),false);
  assert.equal((await worker.fetch(new Request(media),env)).status,200);
  db.prepare('UPDATE pef_objects SET likes=4,views=23 WHERE id=?').run(publicId);
  assert.equal((await call(path+'/invite',admin,'POST')).status,200);
  const invite=new URLSearchParams(new URL(emails[0].text.split('\n').at(-1)).hash.slice(1)).get('invite');
  assert.equal((await call('/api/auth/code/send',null,'POST',{email:'buyer@example.test',invite})).status,400);
  assert.equal((await call('/api/auth/code/send',null,'POST',{email:profile.email,invite})).status,200);
  assert.equal(emails[1].to[0],profile.email);
  const code=emails[1].text.match(/\b\d{6}\b/)[0];
  const claimed=await call('/api/auth/code/verify',null,'POST',{email:profile.email,code,invite});
  assert.equal(claimed.status,200,await claimed.clone().text());
  const sessionResult=await claimed.json();
  assert.equal(sessionResult.expires_in,604800);
  const owner=sessionResult.token;
  assert.equal((await call('/api/auth/code/verify',null,'POST',{email:profile.email,code,invite})).status,400);
  assert.equal((await preview(previewToken)).status,404);
  const publishedAfter=(await feed()).listings.find(row=>row.id===publicId);
  assert.notEqual(publishedAfter.seller_id,pageId);
  assert.equal(publishedAfter.likes,4);
  assert.equal(publishedAfter.views,23);
  const mine=await (await call('/api/listings/mine',owner)).json();
  assert.deepEqual(new Set(mine.listings.map(row=>row.id)),new Set([publicId,privateId]));
  const ownerPath='/api/partners/pages/'+pageId;
  const publicPage='/api/partners/public-profile/'+publishedAfter.seller_id;
  assert.equal(publishedAfter.seller_profile_hidden,1);
  assert.equal((await call(publicPage)).status,404);
  assert.equal((await call(ownerPath+'/presentation',owner,'POST',{public:true})).status,200);
  const publicResponse=await call(publicPage);
  assert.equal(publicResponse.status,200);
  assert.equal((await publicResponse.json()).website,sellerDetails.website);
  assert.equal((await feed()).listings.find(row=>row.id===publicId).seller_profile_hidden,0);
  assert.equal((await call(ownerPath+'/presentation',owner,'POST',{public:false})).status,200);
  assert.equal((await call(publicPage)).status,404);
  assert.equal((await call(ownerPath,buyer)).status,404);
  assert.equal((await call(ownerPath+'/profile',owner,'POST',{...profile,whatsapp:'+351920000000'})).status,200);
  assert.equal((await call(ownerPath+'/publish/'+privateId,owner,'POST',{})).status,200);
  assert.equal((await feed()).listings.find(row=>row.id===privateId).whatsapp,'+351920000000');
  assert.equal((await action(publicId,'hide')).status,200);
  assert.equal((await worker.fetch(new Request(media),env)).status,404);
 }finally{globalThis.fetch=fetchBefore}

 db.prepare('INSERT INTO users(id,email,display_name) VALUES (?,?,?)').run('empty','empty@example.test','Empty account');
 const empty=await session('empty@example.test','seller');
 assert.equal((await call('/api/auth/me',empty)).status,200);
 assert.equal((await data()).accounts.find(row=>row.id==='empty').can_delete,1);
 assert.equal((await data()).accounts.find(row=>row.id==='seller').can_delete,1);
 assert.equal((await action('admin','delete_account')).status,409);
 assert.equal((await action('seller','delete_account')).status,200);
 assert.equal((await action('seller','restore')).status,409);
 assert.equal((await data()).accounts.some(row=>row.id==='seller'),false);
 assert.equal((await feed()).listings.some(row=>row.seller_id==='seller'),false);
 assert.ok(db.prepare('SELECT id FROM pef_objects WHERE seller_id=?').get('seller'));
 assert.equal((await call('/api/auth/me',seller)).status,401);
 assert.equal((await action('empty','delete_account')).status,200);
 assert.equal((await call('/api/auth/me',empty)).status,401);
 assert.equal((await data()).accounts.some(row=>row.id==='empty'),false);
 assert.equal((await data()).history[0].action,'delete_account');

});
