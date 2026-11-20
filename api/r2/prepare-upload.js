// PEF Design R2 migration: fail-closed preparation endpoint.
// No R2 credentials or upload URLs are exposed to the browser.
// This endpoint deliberately refuses uploads until server-side auth,
// durable quotas and usage reconciliation have been implemented.
const MAX_PHOTO=3*1024*1024,MAX_VIDEO=20*1024*1024;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const {kind,size,contentType}=req.body||{};
 const validPhoto=kind==='photo'&&['image/jpeg','image/png','image/webp'].includes(contentType)&&Number.isSafeInteger(size)&&size>0&&size<=MAX_PHOTO;
 const validVideo=kind==='video'&&['video/mp4','video/quicktime','video/webm'].includes(contentType)&&Number.isSafeInteger(size)&&size>0&&size<=MAX_VIDEO;
 if(!validPhoto&&!validVideo)return res.status(400).json({error:'Unsupported media or file exceeds safety limit'});
 return res.status(503).json({error:'R2 uploads are not enabled. Existing upload system remains active.',code:'R2_NOT_ENABLED'});
}
