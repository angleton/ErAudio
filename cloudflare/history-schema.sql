CREATE TABLE history_accounts (
  account TEXT PRIMARY KEY,
  epoch INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE history_rows (
  id INTEGER PRIMARY KEY,
  account TEXT NOT NULL,
  item_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE (account, item_key)
);

CREATE INDEX history_rows_by_revision ON history_rows (account, revision, id);
