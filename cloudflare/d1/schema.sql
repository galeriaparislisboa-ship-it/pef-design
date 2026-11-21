-- PEF Design Cloudflare D1 staging schema (SQLite).
-- Preserve original Supabase UUIDs for referential integrity during migration.
-- No destructive action against Supabase; authentication migration is separate.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,
 email TEXT UNIQUE,
 display_name TEXT,
 created_at TEXT,
 auth_migrated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pef_objects (
 id TEXT PRIMARY KEY,
 seller_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 description TEXT,
 category TEXT,
 price TEXT,
 city TEXT,
 country TEXT,
 whatsapp TEXT,
 video_url TEXT NOT NULL DEFAULT '',
 trim_start REAL DEFAULT 0,
 trim_end REAL DEFAULT 10,
 likes INTEGER DEFAULT 0,
 views INTEGER DEFAULT 0,
 created_at TEXT,
 is_hidden INTEGER DEFAULT 0,
 photos TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(photos)),
 listing_status TEXT DEFAULT 'available' CHECK(listing_status IN ('available','reserved','sold')),
 whatsapp_clicks INTEGER DEFAULT 0,
 media_order TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_order)),
 promotion_price TEXT,
 negotiable INTEGER DEFAULT 0,
 trade INTEGER DEFAULT 0,
 object_date TEXT,
 video_rotation INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pef_objects_seller ON pef_objects(seller_id);
CREATE INDEX IF NOT EXISTS idx_pef_objects_created ON pef_objects(created_at DESC);
CREATE TABLE IF NOT EXISTS pef_seller_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 bio TEXT DEFAULT '',
 updated_at TEXT,
 avatar_url TEXT,
 instagram_username TEXT
);
CREATE TABLE IF NOT EXISTS pef_seller_badges (
 seller_id TEXT PRIMARY KEY REFERENCES users(id),
 badge TEXT DEFAULT 'none',
 updated_at TEXT,
 display_name TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS pef_seller_follows (
 follower_id TEXT NOT NULL REFERENCES users(id),
 seller_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT,
 PRIMARY KEY(follower_id,seller_id)
);
CREATE TABLE IF NOT EXISTS pef_verification_requests (
 id TEXT PRIMARY KEY,
 seller_id TEXT UNIQUE NOT NULL REFERENCES users(id),
 requested_badge TEXT,
 display_name TEXT,
 business_name TEXT DEFAULT '',
 website TEXT DEFAULT '',
 registration_number TEXT DEFAULT '',
 country TEXT DEFAULT '',
 details TEXT DEFAULT '',
 status TEXT DEFAULT 'pending',
 admin_note TEXT DEFAULT '',
 reviewed_at TEXT,
 created_at TEXT
);
CREATE TABLE IF NOT EXISTS pef_reports (
 id TEXT PRIMARY KEY,
 object_id TEXT NOT NULL REFERENCES pef_objects(id),
 reporter_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL,
 details TEXT DEFAULT '',
 created_at TEXT
);
CREATE TABLE IF NOT EXISTS pef_video_jobs (
 id TEXT PRIMARY KEY,
 seller_id TEXT NOT NULL REFERENCES users(id),
 source_path TEXT NOT NULL,
 output_path TEXT NOT NULL,
 trim_start REAL DEFAULT 0,
 music TEXT DEFAULT 'original',
 original_volume REAL DEFAULT 1,
 music_volume REAL DEFAULT 0.3,
 listing TEXT CHECK(listing IS NULL OR json_valid(listing)),
 status TEXT DEFAULT 'pending',
 error TEXT,
 created_at TEXT,
 updated_at TEXT
);
CREATE TABLE IF NOT EXISTS media_migration (
 source_bucket TEXT NOT NULL,
 source_path TEXT NOT NULL,
 destination_key TEXT,
 source_size_bytes INTEGER,
 destination_size_bytes INTEGER,
 source_sha256 TEXT,
 destination_sha256 TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','copied','verified','failed')),
 verified_at TEXT,
 PRIMARY KEY(source_bucket,source_path)
);
CREATE TABLE IF NOT EXISTS media_usage (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id),
 object_key TEXT NOT NULL UNIQUE,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),
 kind TEXT NOT NULL CHECK(kind IN ('photo','video','music')),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS upload_reservations (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id),
 object_key TEXT NOT NULL UNIQUE,
 reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes>0),
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','committed','cancelled'))
);
CREATE TABLE IF NOT EXISTS feature_flags (
 key TEXT PRIMARY KEY,
 enabled INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO feature_flags(key,enabled) VALUES ('r2_uploads',0),('cloudflare_auth',0),('d1_reads',0);
