ALTER TABLE auth_sessions
ADD COLUMN credential_fingerprint TEXT NOT NULL DEFAULT '';
