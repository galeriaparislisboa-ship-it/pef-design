CREATE TABLE IF NOT EXISTS pef_email_codes (
 email TEXT PRIMARY KEY, challenge TEXT NOT NULL, digest TEXT NOT NULL,
 issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL,
 used INTEGER NOT NULL, hour_started INTEGER NOT NULL, hour_requests INTEGER NOT NULL
);
