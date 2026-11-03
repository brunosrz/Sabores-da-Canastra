-- Wrangler applies each numbered migration once. Keep this migration additive:
-- sales, ledger entries and their snapshots remain immutable.
ALTER TABLE sales ADD COLUMN client_created_at TEXT NOT NULL DEFAULT '';
ALTER TABLE sales ADD COLUMN device_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sale_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sale_payments ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sale_payments ADD COLUMN part_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sale_payments ADD COLUMN payment_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS sync_operations (
  operation_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES auth_users(user_id),
  actor_label TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('sale.create', 'sale.cancel', 'sale.adjust_payments')),
  occurred_at TEXT NOT NULL,
  client_created_at TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  hash_version TEXT NOT NULL CHECK (hash_version = 'pdv-op/v1'),
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected_duplicate')),
  result_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_operations_duplicate_window
  ON sync_operations(device_id, payload_hash, operation_type, occurred_at);

CREATE TABLE IF NOT EXISTS sync_duplicate_decisions (
  decision_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES sync_operations(operation_id),
  duplicate_operation_id TEXT NOT NULL REFERENCES sync_operations(operation_id),
  device_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_split_parts (
  sale_id TEXT NOT NULL REFERENCES sales(sale_id),
  part_number INTEGER NOT NULL CHECK (part_number > 0),
  due_cents INTEGER NOT NULL CHECK (due_cents > 0),
  PRIMARY KEY (sale_id, part_number)
);

CREATE TABLE IF NOT EXISTS sale_cancellations (
  cancellation_id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(sale_id),
  ledger_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(ledger_id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES sync_operations(operation_id),
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES auth_users(user_id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_payment_adjustments (
  adjustment_id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(sale_id),
  payment_version INTEGER NOT NULL CHECK (payment_version > 1),
  base_payment_version INTEGER NOT NULL CHECK (base_payment_version > 0),
  ledger_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(ledger_id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES sync_operations(operation_id),
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES auth_users(user_id),
  created_at TEXT NOT NULL,
  UNIQUE (sale_id, payment_version)
);
CREATE INDEX IF NOT EXISTS sale_payment_adjustments_by_sale
  ON sale_payment_adjustments(sale_id, payment_version);

CREATE TABLE IF NOT EXISTS sale_payment_adjustment_lines (
  line_id TEXT PRIMARY KEY,
  adjustment_id TEXT NOT NULL REFERENCES sale_payment_adjustments(adjustment_id),
  method TEXT NOT NULL CHECK (method IN ('Dinheiro', 'Débito', 'Crédito', 'Pix')),
  method_label TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  fee_rate TEXT NOT NULL,
  fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0),
  part_number INTEGER NOT NULL CHECK (part_number > 0),
  position INTEGER NOT NULL CHECK (position >= 0)
);
CREATE INDEX IF NOT EXISTS sale_payment_adjustment_lines_by_adjustment
  ON sale_payment_adjustment_lines(adjustment_id, position);

CREATE TABLE IF NOT EXISTS ledger_compensations (
  compensation_id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(ledger_id),
  sale_id TEXT NOT NULL REFERENCES sales(sale_id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES sync_operations(operation_id),
  compensation_type TEXT NOT NULL CHECK (compensation_type IN ('sale_cancellation', 'payment_adjustment')),
  direction TEXT NOT NULL CHECK (direction IN ('reversal', 'increase')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES auth_users(user_id),
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS sync_operations_no_update BEFORE UPDATE ON sync_operations
BEGIN SELECT RAISE(ABORT, 'sync operations are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sync_operations_no_delete BEFORE DELETE ON sync_operations
BEGIN SELECT RAISE(ABORT, 'sync operations are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sync_duplicate_decisions_no_update BEFORE UPDATE ON sync_duplicate_decisions
BEGIN SELECT RAISE(ABORT, 'duplicate decisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sync_duplicate_decisions_no_delete BEFORE DELETE ON sync_duplicate_decisions
BEGIN SELECT RAISE(ABORT, 'duplicate decisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sale_split_parts_no_update BEFORE UPDATE ON sale_split_parts
BEGIN SELECT RAISE(ABORT, 'sale split parts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS sale_split_parts_no_delete BEFORE DELETE ON sale_split_parts
BEGIN SELECT RAISE(ABORT, 'sale split parts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS sale_cancellations_no_update BEFORE UPDATE ON sale_cancellations
BEGIN SELECT RAISE(ABORT, 'sale cancellations are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sale_cancellations_no_delete BEFORE DELETE ON sale_cancellations
BEGIN SELECT RAISE(ABORT, 'sale cancellations are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sale_payment_adjustments_no_update BEFORE UPDATE ON sale_payment_adjustments
BEGIN SELECT RAISE(ABORT, 'sale payment adjustments are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sale_payment_adjustments_no_delete BEFORE DELETE ON sale_payment_adjustments
BEGIN SELECT RAISE(ABORT, 'sale payment adjustments are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sale_payment_adjustment_lines_no_update BEFORE UPDATE ON sale_payment_adjustment_lines
BEGIN SELECT RAISE(ABORT, 'adjustment snapshots are immutable'); END;
CREATE TRIGGER IF NOT EXISTS sale_payment_adjustment_lines_no_delete BEFORE DELETE ON sale_payment_adjustment_lines
BEGIN SELECT RAISE(ABORT, 'adjustment snapshots are immutable'); END;
CREATE TRIGGER IF NOT EXISTS ledger_compensations_no_update BEFORE UPDATE ON ledger_compensations
BEGIN SELECT RAISE(ABORT, 'ledger compensations are append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_compensations_no_delete BEFORE DELETE ON ledger_compensations
BEGIN SELECT RAISE(ABORT, 'ledger compensations are append-only'); END;
