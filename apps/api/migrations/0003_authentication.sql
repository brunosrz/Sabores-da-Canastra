CREATE TABLE IF NOT EXISTS auth_users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(user_id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS auth_sessions_by_user ON auth_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  bucket_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
);

ALTER TABLE ledger_entries ADD COLUMN actor_user_id TEXT REFERENCES auth_users(user_id);
CREATE INDEX IF NOT EXISTS ledger_entries_by_actor ON ledger_entries(actor_user_id, occurred_on);
