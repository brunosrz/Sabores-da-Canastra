CREATE TABLE IF NOT EXISTS product_price_changes (
  operation_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(product_id),
  old_price_cents INTEGER,
  new_price_cents INTEGER NOT NULL CHECK (new_price_cents >= 0),
  actor_user_id TEXT NOT NULL REFERENCES users(user_id),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS product_price_changes_by_product
  ON product_price_changes(product_id, recorded_at DESC);

CREATE TRIGGER IF NOT EXISTS product_price_changes_no_update
BEFORE UPDATE ON product_price_changes
BEGIN SELECT RAISE(ABORT, 'product price history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS product_price_changes_no_delete
BEFORE DELETE ON product_price_changes
BEGIN SELECT RAISE(ABORT, 'product price history is append-only'); END;
