-- PEF beta Cloudflare D1 schema (new beta tables; does not overwrite imported data)
CREATE TABLE IF NOT EXISTS beta_listings (
 id TEXT PRIMARY KEY,
 owner_token_hash TEXT NOT NULL,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 price REAL NOT NULL CHECK(price > 0),
 category TEXT NOT NULL DEFAULT 'Objects',
 city TEXT NOT NULL,
 country TEXT NOT NULL,
 whatsapp TEXT NOT NULL,
 media_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','deleted')),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS beta_listings_status_created ON beta_listings(status,created_at DESC);
