import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile, rename, writeFile} from 'node:fs/promises';
import {demoListings, matches, previewDigest, refreshAlerts} from './model.mjs';

const stateFile = process.env.PEF_PILOT_STATE || '/tmp/pef-pilot-state.json';
const state = await readFile(stateFile, 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return {listings:structuredClone(demoListings), selections:[], alerts:[], lastDigest:null};
});
const galleryPhone = /^\d{8,15}$/.test(process.env.PEF_PILOT_WHATSAPP ?? '') ? process.env.PEF_PILOT_WHATSAPP : null;
const html = await readFile(new URL('./index.html', import.meta.url));
let writes = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(state);
  writes = writes.catch(() => {}).then(async () => {
    await writeFile(stateFile + '.tmp', snapshot, {mode:0o600});
    await rename(stateFile + '.tmp', stateFile);
  });
  return writes;
}

createServer(async (request, response) => {
  const {pathname} = new URL(request.url, 'http://localhost');
  const reply = (status, body) => {
    response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    response.end(JSON.stringify(body));
  };
  const publicMatch = pathname.match(/^\/api\/selection\/([a-f0-9-]{36})$/);
  try {
    if (request.method === 'GET') {
      if (publicMatch) {
        const selection = state.selections.find(record => record.id === publicMatch[1] && record.active);
        if (!selection) return reply(404, {error:'Cette sélection est indisponible.'});
        return reply(200, {title:selection.title, galleryPhone, listings:selection.ids.map(id => state.listings.find(item => item.id === id)).filter(Boolean)});
      }
      if (pathname === '/api/state') return reply(200, state);
      if (pathname !== '/' && !pathname.startsWith('/selection/')) return reply(404, {error:'Page introuvable.'});
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return response.end(html);
    }
    if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) return reply(405, {error:'Action indisponible.'});
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 16384) return reply(413, {error:'Requête trop longue.'});
    }
    let data;
    try { data = JSON.parse(raw); } catch { return reply(400, {error:'Requête invalide.'}); }
    if (!data || typeof data !== 'object') return reply(400, {error:'Requête invalide.'});
    let result = {ok:true};
    if (pathname === '/api/selections') {
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const existing = state.selections.find(record => record.id === data.id);
      if (data.id && !existing) return reply(404, {error:'Sélection introuvable.'});
      if (!title || title.length > 120 || !Array.isArray(data.ids) || !data.ids.length ||
          !data.ids.every(id => state.listings.some(item => item.id === id))) return reply(400, {error:'Indique un titre et choisis au moins une pièce.'});
      result = {id:existing?.id ?? randomUUID(), title, ids:[...new Set(data.ids)], active:existing?.active ?? true};
      if (existing) Object.assign(existing, result);
      else state.selections.push(result);
    } else if (pathname === '/api/selections/status') {
      const existing = state.selections.find(record => record.id === data.id);
      if (!existing) return reply(404, {error:'Sélection introuvable.'});
      existing.active = false;
    } else if (pathname === '/api/alerts') {
      const {category, city, maxPrice} = data;
      if (!['','Lighting','Ceramics'].includes(category) || typeof city !== 'string' || city.length > 80 ||
          (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0))) return reply(400, {error:'Filtres invalides.'});
      const existing = state.alerts.find(alert => alert.id === data.id);
      if (data.id && !existing) return reply(404, {error:'Alerte introuvable.'});
      result = {id:existing?.id ?? randomUUID(), category, city:city.trim(), maxPrice, pending:[]};
      result.matches = state.listings.filter(item => matches(item, result)).map(item => item.id);
      if (existing) Object.assign(existing, result);
      else state.alerts.push(result);
    } else if (pathname === '/api/alerts/stop') {
      state.alerts = state.alerts.filter(alert => alert.id !== data.id);
    } else if (pathname === '/api/catalog') {
      const item = state.listings.find(listing => listing.id === data.id);
      if (!item || !['available','reserved','sold'].includes(data.status) || !Number.isFinite(data.price) || data.price < 0) return reply(400, {error:'Annonce invalide.'});
      Object.assign(item, {price:data.price, status:data.status});
      refreshAlerts(state);
    } else if (pathname === '/api/catalog/new') {
      const count = state.listings.length - demoListings.length + 1;
      state.listings.push({id:randomUUID(), title:'Applique de test ' + count,
        category:'Lighting', city:'Lisbonne', price:450, status:'available'});
      refreshAlerts(state);
    } else if (pathname === '/api/digest') {
      const day = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Lisbon'}).format(new Date());
      result = {digest:previewDigest(state, day)};
    } else return reply(404, {error:'Action introuvable.'});
    await save();
    return reply(200, result);
  } catch (error) {
    console.error(error.message);
    return reply(500, {error:'Erreur du serveur de test.'});
  }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1');
