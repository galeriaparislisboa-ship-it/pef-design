const tables = [
  "CREATE TABLE IF NOT EXISTS pef_deleted_accounts (user_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  `CREATE TABLE IF NOT EXISTS pef_partner_pages (
    id TEXT PRIMARY KEY REFERENCES users(id), name TEXT NOT NULL, city TEXT NOT NULL,
    country TEXT NOT NULL, whatsapp TEXT NOT NULL DEFAULT '', email TEXT NOT NULL,
    preview_hash TEXT UNIQUE, preview_until INTEGER, invite_hash TEXT UNIQUE, invite_until INTEGER,
    owner_id TEXT REFERENCES users(id), claim_event TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS pef_partner_listings (
    id TEXT PRIMARY KEY REFERENCES pef_objects(id), page_id TEXT NOT NULL REFERENCES pef_partner_pages(id),
    source_url TEXT NOT NULL DEFAULT '', consent TEXT, published_at TEXT
  )`,

  "CREATE TABLE IF NOT EXISTS pef_archived_accounts (user_id TEXT PRIMARY KEY, archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE IF NOT EXISTS pef_listing_likes (listing_id TEXT NOT NULL REFERENCES pef_objects(id) ON DELETE CASCADE, user_id TEXT NOT NULL, PRIMARY KEY (listing_id,user_id))",
  "CREATE TABLE IF NOT EXISTS pef_reports (id TEXT PRIMARY KEY, object_id TEXT NOT NULL, reporter_id TEXT NOT NULL, reason TEXT NOT NULL, details TEXT, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS pef_report_reviews (report_id TEXT PRIMARY KEY, status TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS pef_seller_badges (seller_id TEXT PRIMARY KEY, badge TEXT, updated_at TEXT, display_name TEXT)",
  "CREATE TABLE IF NOT EXISTS pef_seller_profiles (user_id TEXT PRIMARY KEY, bio TEXT, avatar_url TEXT, instagram_username TEXT, updated_at TEXT)",
  "CREATE TABLE IF NOT EXISTS pef_verification_requests (id TEXT PRIMARY KEY, seller_id TEXT UNIQUE NOT NULL, requested_badge TEXT, display_name TEXT, business_name TEXT, website TEXT, registration_number TEXT, country TEXT, details TEXT, status TEXT, admin_note TEXT, reviewed_at TEXT, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS pef_moderation_log (id TEXT PRIMARY KEY, actor TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
];
export const visibleListing = "COALESCE(is_hidden,0)=0 AND NOT EXISTS (SELECT 1 FROM pef_archived_accounts WHERE user_id=pef_objects.seller_id) AND NOT EXISTS (SELECT 1 FROM pef_partner_listings WHERE id=pef_objects.id AND published_at IS NULL)";
export const listingLikeCount = 'COALESCE(pef_objects.likes,0)+(SELECT COUNT(*) FROM pef_listing_likes WHERE listing_id=pef_objects.id) AS likes';
const initialized = new WeakMap();
export function initializeModeration(db) {
  if (!initialized.has(db)) {
    initialized.set(db,db.batch(tables.map(sql=>db.prepare(sql))).then(()=>db.batch([
      db.prepare('CREATE INDEX IF NOT EXISTS pef_listing_likes_user ON pef_listing_likes(user_id)'),
      db.prepare('CREATE INDEX IF NOT EXISTS pef_partner_listings_page ON pef_partner_listings(page_id)'),
    ])).catch(error=>{initialized.delete(db);throw error}));
  }
  return initialized.get(db);
}

const reasons = new Set(['Inappropriate content', 'Misleading listing', 'Spam', 'Other']);
const listingColumns = `id,seller_id,title,description,price,category,city,country,whatsapp,listing_status,promotion_price,object_date,negotiable,trade,views,${listingLikeCount},whatsapp_clicks,photos,video_url,media_order,is_hidden,created_at`;
const accountQuery = `SELECT u.id,u.email,u.display_name,a.archived_at,b.badge,
  CASE WHEN p.user_id IS NOT NULL OR lower(u.email)='galeriaparislisboa@gmail.com' THEN 1 ELSE 0 END AS gallery,
  (SELECT COUNT(*) FROM pef_objects WHERE seller_id=u.id) AS listings,
  (lower(u.email)<>'ndondina@muchimuchi.fr') AS can_delete
  FROM users u LEFT JOIN pef_archived_accounts a ON a.user_id=u.id
  LEFT JOIN pef_seller_profiles p ON p.user_id=u.id LEFT JOIN pef_seller_badges b ON b.seller_id=u.id`;

export async function moderation(request, db, user, out) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (!user) return out({error:'Unauthorized'},401);
  const admin = path.startsWith('/api/admin/');
  if (admin && user.role !== 'admin') return out({error:'Forbidden'},403);
  if (!db) return out({error:'Database unavailable'},503);
  try {
    await initializeModeration(db);
    const query = (sql, ...args) => db.prepare(sql).bind(...args);
    const rows = async (sql, ...args) => (await query(sql,...args).all()).results;
    if (admin && method === 'GET' && path === '/api/admin/moderation') {
      const [listings,accounts,reports,requests,history] = await Promise.all([
        rows(`SELECT ${listingColumns}, EXISTS(SELECT 1 FROM pef_archived_accounts WHERE user_id=seller_id) AS seller_archived FROM pef_objects ORDER BY created_at DESC,id`),
        rows(accountQuery+' WHERE NOT EXISTS(SELECT 1 FROM pef_deleted_accounts WHERE user_id=u.id) ORDER BY u.display_name,u.email'),
        rows(`SELECT r.*,COALESCE(s.status,'pending') AS status,o.title,u.email AS reporter
          FROM pef_reports r LEFT JOIN pef_report_reviews s ON s.report_id=r.id
          LEFT JOIN pef_objects o ON o.id=r.object_id LEFT JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC`),
        rows(`SELECT r.*,u.email FROM pef_verification_requests r JOIN users u ON u.id=r.seller_id ORDER BY r.created_at DESC`),
        rows('SELECT * FROM pef_moderation_log ORDER BY created_at DESC,rowid DESC LIMIT 100'),
      ]);
      return out({listings,accounts,reports,requests,history});
    }

    const account = await query(`SELECT u.id,a.archived_at FROM users u
      LEFT JOIN pef_archived_accounts a ON a.user_id=u.id WHERE lower(u.email)=?`,user.email.toLowerCase()).first();
    if (!account || account.archived_at) return out({error:'Account unavailable'},403);
    if (path === '/api/verification' && method === 'GET') {
      return out({request:await query('SELECT display_name,business_name,website,country,details,status,admin_note FROM pef_verification_requests WHERE seller_id=?',account.id).first()});
    }
    const body = await request.json().catch(()=>null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return out({error:'Invalid request'},400);
    const limited = (key,max=500) => typeof body[key]==='string' && body[key].trim().length<=max ? body[key].trim() : null;
    if (path === '/api/reports' && method === 'POST') {
      const id=limited('id',160), reason=limited('reason',60), details=limited('details');
      if (!id || !reasons.has(reason) || details===null) return out({error:'Invalid report'},400);
      const result=await query(`INSERT INTO pef_reports (id,object_id,reporter_id,reason,details,created_at)
        SELECT ?,id,?,?,?,CURRENT_TIMESTAMP FROM pef_objects WHERE id=? AND ${visibleListing}
        AND NOT EXISTS (SELECT 1 FROM pef_reports r LEFT JOIN pef_report_reviews s ON s.report_id=r.id
          WHERE r.object_id=? AND r.reporter_id=? AND s.report_id IS NULL)`,
        crypto.randomUUID(),account.id,reason,details,id,id,account.id).run();
      if (!result.meta.changes) return out({error:'Listing unavailable or already reported'},409);
      return out({ok:true},201);
    }
    if (path === '/api/verification' && method === 'POST') {
      const name=limited('display_name',120), business=limited('business_name',120), website=limited('website',250), country=limited('country',100), details=limited('details');
      if (!name || [business,website,country,details].includes(null)) return out({error:'Invalid application'},400);
      if (website) {
        let parsed;
        try { parsed=new URL(website); } catch { return out({error:'Enter a complete website URL'},400); }
        if (!['http:','https:'].includes(parsed.protocol)) return out({error:'Invalid website'},400);
      }
      const result=await query(`INSERT INTO pef_verification_requests
        (id,seller_id,requested_badge,display_name,business_name,website,country,details,status,created_at)
        VALUES (?,?,'verified',?,?,?,?,?,'pending',CURRENT_TIMESTAMP)
        ON CONFLICT(seller_id) DO UPDATE SET display_name=excluded.display_name,business_name=excluded.business_name,
        website=excluded.website,country=excluded.country,details=excluded.details,status='pending',
        admin_note='',reviewed_at=NULL,created_at=CURRENT_TIMESTAMP WHERE pef_verification_requests.status<>'approved'`,
        crypto.randomUUID(),account.id,name,business,website,country,details).run();
      return result.meta.changes ? out({ok:true}) : out({error:'This account is already verified'},409);
    }
    if (path !== '/api/admin/moderation' || method !== 'PATCH') return out({error:'Not found'},404);

    const id=limited('id',160), action=limited('action',40), note=limited('note');
    if (!id || !action || note===null) return out({error:'Invalid decision'},400);
    let change, followup;
    if (action==='hide' || action==='show') {
      change=query(`UPDATE pef_objects SET is_hidden=? WHERE id=? AND COALESCE(is_hidden,0)<>?
        AND (?='hide' OR NOT EXISTS(SELECT 1 FROM pef_partner_listings WHERE id=pef_objects.id AND published_at IS NULL))`,Number(action==='hide'),id,Number(action==='hide'),action);
    } else if (action==='delete_account') {
      change=query(`INSERT OR IGNORE INTO pef_deleted_accounts(user_id)
        SELECT id FROM users WHERE id=? AND lower(email)<>'ndondina@muchimuchi.fr'`,id);
    } else if (action==='archive' || action==='restore') {
      const target=await query('SELECT email FROM users WHERE id=?',id).first();
      if (!target) return out({error:'Account not found'},404);
      if (target.email?.toLowerCase()==='ndondina@muchimuchi.fr') return out({error:'The administrator account is protected'},403);
      change=action==='archive' ? query('INSERT OR IGNORE INTO pef_archived_accounts(user_id) VALUES (?)',id) :
        query('DELETE FROM pef_archived_accounts WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM pef_deleted_accounts WHERE user_id=?)',id,id);
    } else if (['resolve','dismiss','reopen'].includes(action)) {
      change=action==='reopen' ? query('DELETE FROM pef_report_reviews WHERE report_id=?',id) :
        query('INSERT OR IGNORE INTO pef_report_reviews SELECT id,? FROM pef_reports WHERE id=?',action==='resolve'?'resolved':'dismissed',id);
    } else if (['approve','reject','revoke'].includes(action)) {
      const status={approve:'approved',reject:'rejected',revoke:'revoked'}[action];
      const previous=action==='revoke'?'approved':'pending';
      change=query(`UPDATE pef_verification_requests SET status=?,admin_note=?,reviewed_at=CURRENT_TIMESTAMP
        WHERE id=? AND status=? AND (?<>'approved' OR NOT EXISTS(SELECT 1 FROM pef_archived_accounts WHERE user_id=seller_id))`,status,note,id,previous,status);
      if (action!=='reject') followup=query(`INSERT INTO pef_seller_badges(seller_id,badge,updated_at,display_name)
        SELECT seller_id,?,CURRENT_TIMESTAMP,display_name FROM pef_verification_requests WHERE id=? AND changes()=1
        ON CONFLICT(seller_id) DO UPDATE SET badge=excluded.badge,updated_at=excluded.updated_at,display_name=excluded.display_name`,action==='approve'?'verified':'none',id);
    } else return out({error:'Unknown action'},400);
    const history=query(`INSERT INTO pef_moderation_log (id,actor,target,action,note)
      SELECT ?,?,?,?,? WHERE changes()=1`,crypto.randomUUID(),user.email,id,action,note);
    const archiveDeleted=action==='delete_account'?[query(`INSERT INTO pef_archived_accounts(user_id)
      SELECT ? WHERE changes()=1 ON CONFLICT(user_id) DO UPDATE SET archived_at=CURRENT_TIMESTAMP`,id)]:[];
    const result=await db.batch([change,...archiveDeleted,history,...(followup ? [followup] : [])]);
    if(action==='delete_account'&&!result[0].meta.changes)return out({error:'Ce compte est protégé ou a déjà été supprimé.'},409);
    return result[0].meta.changes ? out({ok:true}) : out({error:'This item has already changed or is unavailable. Refresh the queue.'},409);
  } catch (error) {
    if(/FOREIGN KEY constraint failed/i.test(error.message))
      return out({error:'Ce compte est lié à des données PEF. Utilisez Archiver pour le désactiver.'},409);
    console.error('Moderation:',error.message);
    return out({error:'Moderation temporarily unavailable'},503);
  }
}
