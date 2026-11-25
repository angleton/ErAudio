CREATE TABLE IF NOT EXISTS history_paired_sessions (
  token_hash TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS history_paired_sessions_expiry ON history_paired_sessions (expires_at);
CREATE INDEX IF NOT EXISTS history_paired_sessions_account ON history_paired_sessions (account, expires_at);
