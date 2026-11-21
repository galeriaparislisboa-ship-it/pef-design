// PEF Design: read-only text listings from the existing pef_objects D1 table.
// No media migration, writes, or authentication changes.
// Deploy separately only after confirming the production D1 binding and reviewing the public fields.
const PUBLIC_FIELDS = ['id','title','description','price','category','city','country','created_at','status'];
const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/api/text-listings') return new Response('Not found',{status:404});
    if (!env.DB) return Response.json({error:'D1 DB binding missing'},{status:503,headers:HEADERS});
    try {
      const schema = await env.DB.prepare('PRAGMA table_info(pef_objects)').all();
      const columns = new Set((schema.results || []).map(row => row.name));
      const selected = PUBLIC_FIELDS.filter(field => columns.has(field));
      if (!columns.has('id') || !columns.has('title')) return Response.json({error:'Review pef_objects schema before publication'},{status:503,headers:HEADERS});
      const order = columns.has('created_at') ? ' ORDER BY created_at DESC' : '';
      const query = 'SELECT ' + selected.map(field => '"' + field + '"').join(', ') + ' FROM pef_objects' + order + ' LIMIT 100';
      const rows = await env.DB.prepare(query).all();
      return Response.json({listings:(rows.results || []).map(row => ({...row,media:[]})),count:(rows.results || []).length},{headers:HEADERS});
    } catch {
      return Response.json({error:'Unable to read listings'},{status:500,headers:HEADERS});
    }
  }
};
