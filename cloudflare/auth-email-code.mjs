// Used after the caller has normalized the email and applied request-rate limits.
const lifetime = 10 * 60 * 1000;
const cooldown = 60 * 1000;
const maxAttempts = 5;

async function proof(secret, id, email, code) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify([id,email,code])));
  return Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2,'0')).join('');
}

export async function issueCode(db, secret, email, deliver) {
  if (!secret) throw new Error('Missing OTP signing key');
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294000000);
  const code = String(value % 1000000).padStart(6,'0');
  const id = crypto.randomUUID(), now = Date.now();
  const hash = await proof(secret,id,email,code);
  const inserted = await db.prepare(`INSERT INTO auth_email_codes
    (id,email,code_hash,expires_at,created_at)
    SELECT ?,?,?,?,? WHERE NOT EXISTS (
      SELECT 1 FROM auth_email_codes WHERE email=? AND created_at>?
    )`).bind(id,email,hash,new Date(now+lifetime).toISOString(),new Date(now).toISOString(),
      email,new Date(now-cooldown).toISOString()).run();
  if (!inserted.meta.changes) return false;
  try { await deliver(email,code); } catch (error) {
    await db.prepare('UPDATE auth_email_codes SET consumed_at=? WHERE id=?')
      .bind(new Date().toISOString(),id).run();
    throw error;
  }
  return true;
}

export async function consumeCode(db, secret, email, code) {
  if (!secret || typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const row = await db.prepare('SELECT id FROM auth_email_codes WHERE email=? ORDER BY created_at DESC LIMIT 1').bind(email).first();
  if (!row) return false;
  const hash = await proof(secret,row.id,email,code), now = new Date().toISOString();
  const updated = await db.prepare(`UPDATE auth_email_codes SET attempts=attempts+1,
    consumed_at=CASE WHEN code_hash=? THEN ? ELSE NULL END
    WHERE id=? AND consumed_at IS NULL AND expires_at>? AND attempts<?
    AND id=(SELECT id FROM auth_email_codes WHERE email=? ORDER BY created_at DESC LIMIT 1)
    RETURNING consumed_at`).bind(hash,now,row.id,now,maxAttempts,email).first();
  return Boolean(updated?.consumed_at);
}
