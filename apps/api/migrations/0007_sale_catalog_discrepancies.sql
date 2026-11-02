CREATE TABLE IF NOT EXISTS sale_catalog_discrepancies (
  discrepancy_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES sync_operations(operation_id),
  sale_id TEXT NOT NULL REFERENCES sales(sale_id),
  product_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  current_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sale_catalog_discrepancies_sale
  ON sale_catalog_discrepancies(sale_id, recorded_at);

CREATE TRIGGER IF NOT EXISTS sale_catalog_discrepancies_no_update
BEFORE UPDATE ON sale_catalog_discrepancies
BEGIN SELECT RAISE(ABORT, 'sale catalog discrepancies are append-only'); END;

CREATE TRIGGER IF NOT EXISTS sale_catalog_discrepancies_no_delete
BEFORE DELETE ON sale_catalog_discrepancies
BEGIN SELECT RAISE(ABORT, 'sale catalog discrepancies are append-only'); END;
