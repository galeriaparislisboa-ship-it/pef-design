// Server-side, read-only Instagram preview for the gallery's authorized test account.
// Never return the access token to the browser.
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=600');
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  const token=(process.env.INSTAGRAM_ACCESS_TOKEN||'').trim();
  if(!token) return res.status(503).json({error:'Instagram is not configured'});
  const accountId='17841434467277923';
  const fields='id,username,followers_count,follows_count,media_count,media.limit(12){id,media_type,media_url,thumbnail_url,timestamp}';
  try {
    const url='https://graph.instagram.com/v24.0/'+accountId+'?fields='+encodeURIComponent(fields);
    const upstream=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
    const payload=await upstream.json();
    if(!upstream.ok||payload.error) {
      const code=payload.error?.code||upstream.status;
      return res.status(502).json({error:code===190?'Instagram access token rejected by Meta':'Instagram API unavailable',code,subcode:payload.error?.error_subcode||null,action:code===190?'Regenerate the Instagram access token in Meta, replace INSTAGRAM_ACCESS_TOKEN in Vercel Production, then redeploy.':'Check Meta permissions and API configuration.'});
    }
    const media=(payload.media?.data||[]).slice(0,12).filter(p=>p.media_url||p.thumbnail_url).map(p=>({id:p.id,type:p.media_type,image:p.thumbnail_url||p.media_url,video:p.media_type==='VIDEO'?p.media_url:null}));
    return res.status(200).json({username:payload.username||'galerie_paris_lisbon',followers:payload.followers_count??null,following:payload.follows_count??null,posts:payload.media_count??null,media});
  }catch(e){return res.status(502).json({error:'Instagram request failed'});}
};
