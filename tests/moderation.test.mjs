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
    });
    return {...bind(),bind};
   },
   async batch(statements){
    db.exec('BEGIN');
    try{
     const result=[];
     for(const statement of statements)result.push(await statement.run());
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
 assert.equal((await call('/api/reports',buyer,'POST',{id:'object',reason:'Spam',details:'test report'})).status,201);
 assert.equal((await call('/api/reports',buyer,'POST',{id:'object',reason:'Spam',details:'duplicate'})).status,409);
 const report=(await data()).reports[0];
 assert.equal(report.status,'pending');
 assert.equal((await action('object','hide')).status,200);
 assert.deepEqual((await feed()).listings.map(x=>x.id),['second']);
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
});
