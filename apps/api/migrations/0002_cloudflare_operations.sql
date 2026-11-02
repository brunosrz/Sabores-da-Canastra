CREATE TABLE IF NOT EXISTS sale_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(sale_id),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sale_idempotency_by_created_at
  ON sale_idempotency(created_at);
