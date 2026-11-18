// Server-side, read-only Instagram preview for the gallery's authorized test account.
// Never return the access token to the browser.
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=600');
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  const token=(process.env.INSTAGRAM_ACCESS_TOKEN||'').trim();
  if(!token) return res.status(503).json({error:'Instagram is not configured'});
  const accountId='17841434467277923';
  const fields='id,username,followers_count,follows_count,media_count,media.limit(12){id,media_type,media_url,thumbnail_url,media_audio_type,permalink,timestamp,children{media_type,media_url,thumbnail_url}}';
  try {
    // Unified Login issues Meta/Facebook tokens (EAAY...), which use graph.facebook.com.
    // Instagram Login tokens use graph.instagram.com instead.
    const host=token.startsWith('IG')?'graph.instagram.com':'graph.facebook.com';
    const url='https://'+host+'/v24.0/'+accountId+'?fields='+encodeURIComponent(fields);
    const upstream=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
    const payload=await upstream.json();
    if(!upstream.ok||payload.error) {
      const code=payload.error?.code||upstream.status;
      return res.status(502).json({error:code===190?'Instagram access token rejected by Meta':'Instagram API unavailable',code,subcode:payload.error?.error_subcode||null,action:code===190?'Regenerate the Instagram access token in Meta, replace INSTAGRAM_ACCESS_TOKEN in Vercel Production, then redeploy.':'Check Meta permissions and API configuration.'});
    }
    // Meta sometimes omits media_url for VIDEO in nested media edges. Query each video
    // directly, and only expose a playable URL when Meta actually supplies one.
    const entries=(payload.media?.data||[]).slice(0,12);
    const videoDiagnostics=[];
    await Promise.all(entries.filter(p=>p.media_type==='VIDEO'&&!p.media_url).map(async p=>{
      try{
        const detailUrl='https://'+host+'/v24.0/'+encodeURIComponent(p.id)+'?fields=media_type,media_url,thumbnail_url,media_audio_type,permalink';
        const detailRes=await fetch(detailUrl,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(6000)});
        const detail=await detailRes.json();
        if(detailRes.ok){if(detail.media_url)p.media_url=detail.media_url;if(detail.media_audio_type)p.media_audio_type=detail.media_audio_type;if(detail.permalink)p.permalink=detail.permalink;if(detail.thumbnail_url&&!p.thumbnail_url)p.thumbnail_url=detail.thumbnail_url;}
        videoDiagnostics.push({id:p.id,httpStatus:detailRes.status,mediaUrlAvailable:!!detail.media_url,audioType:detail.media_audio_type||null,permalinkAvailable:!!detail.permalink,errorCode:detail.error?.code||null,errorSubcode:detail.error?.error_subcode||null});
      }catch(e){videoDiagnostics.push({id:p.id,httpStatus:null,mediaUrlAvailable:false,errorCode:'network_or_timeout'});console.warn('Instagram video detail lookup failed',p.id)}
    }));
    const media=entries.filter(p=>p.media_url||p.thumbnail_url).map(p=>({id:p.id,type:p.media_type,permalink:p.permalink||null,image:p.thumbnail_url||p.media_url,video:p.media_type==='VIDEO'?(p.media_url||null):null,slides:(p.children?.data||[]).map(x=>({type:x.media_type,image:x.thumbnail_url||x.media_url,video:x.media_type==='VIDEO'?(x.media_url||null):null}))}));
    const diagnosticRequested=req.query?.diagnostic==='1';
    return res.status(200).json({...(diagnosticRequested?{diagnostic:{host,videoDiagnostics,videoCount:entries.filter(p=>p.media_type==='VIDEO').length,videoPlayableCount:media.filter(p=>p.type==='VIDEO'&&p.video).length}}:{}),username:payload.username||'galerie_paris_lisbon',followers:payload.followers_count??null,following:payload.follows_count??null,posts:payload.media_count??null,media});
  }catch(e){return res.status(502).json({error:'Instagram request failed'});}
};
