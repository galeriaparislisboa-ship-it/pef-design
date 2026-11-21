// PEF Design Cloudflare Worker — staging only.
// This worker performs read-only infrastructure checks. It does not migrate
// accounts, authenticate users, accept uploads, or expose stored media.
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': 'https://pef-design.vercel.app',
  'Vary': 'Origin'
};
function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
    if (url.pathname === '/health') {
      return reply({ service: 'pef-design-api', status: 'ok', mode: 'staging-read-only' });
    }
    if (url.pathname === '/health/dependencies') {
      // Do not expose schema, row counts, object keys, or exception details.
      let db = false, media = false;
      try {
        if (env.DB) {
          const result = await env.DB.prepare('SELECT 1 AS ok').first();
          db = result?.ok === 1;
        }
      } catch (_) {}
      try {
        if (env.MEDIA) {
          await env.MEDIA.head('__pef_healthcheck_nonexistent__');
          media = true; // null is valid: R2 binding successfully answered.
        }
      } catch (_) {}
      return reply({ service: 'pef-design-api', db, media, ready: db && media }, db && media ? 200 : 503);
    }
    return reply({ error: 'Not found', code: 'NOT_ENABLED' }, 404);
  }
};
