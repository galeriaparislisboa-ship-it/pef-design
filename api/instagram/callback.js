// PEF Design — Instagram OAuth callback endpoint.
// The authorization code is intentionally never exposed to browser JavaScript.
// A server-side code exchange and secure per-seller token storage must be
// configured before enabling the Connect Instagram button.
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  // Do not log, reflect, or persist OAuth codes or state.
  const params=new URLSearchParams({instagram:'setup_required'});
  res.statusCode=302;
  res.setHeader('Location','/?'+params.toString()+'#profile');
  return res.end();
}
