-- PEF Design authentication tables. Additive only: does not modify legacy users/listings.
CREATE TABLE IF NOT EXISTS auth_identities (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 provider_user_id TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);
CREATE TABLE IF NOT EXISTS auth_sessions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_email_codes (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 code_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 consumed_at TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_email_codes_email ON auth_email_codes(email);

-- Security notes: do not use existing legacy users as verified accounts without
-- email ownership verification. Hash session tokens and OTPs; limit attempts.
-- Google OAuth requires state, PKCE, nonce and server-side ID token validation.
-- Do not deploy unauthenticated beta publishing endpoints to production.
