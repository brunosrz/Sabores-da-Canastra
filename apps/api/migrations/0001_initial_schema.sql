PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  category_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  barcode TEXT,
  auxiliary_code TEXT,
  name TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES categories(category_id),
  unit TEXT NOT NULL DEFAULT 'un',
  sale_price_cents INTEGER CHECK (sale_price_cents IS NULL OR sale_price_cents >= 0),
  unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique ON products(barcode) WHERE barcode IS NOT NULL AND barcode <> '';
CREATE UNIQUE INDEX IF NOT EXISTS products_auxiliary_code_unique ON products(auxiliary_code) WHERE auxiliary_code IS NOT NULL AND auxiliary_code <> '';
CREATE INDEX IF NOT EXISTS products_category_name ON products(category_id, name);

CREATE TABLE IF NOT EXISTS ingredients (
  ingredient_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_unit TEXT NOT NULL CHECK (base_unit IN ('g', 'ml', 'un')),
  pack_quantity TEXT NOT NULL CHECK (CAST(pack_quantity AS REAL) > 0),
  supplier TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingredient_quotes (
  quote_id TEXT PRIMARY KEY,
  ingredient_id TEXT NOT NULL REFERENCES ingredients(ingredient_id),
  pack_price_cents INTEGER CHECK (pack_price_cents IS NULL OR pack_price_cents >= 0),
  pack_quantity TEXT NOT NULL,
  base_unit TEXT NOT NULL,
  supplier TEXT,
  quoted_on TEXT CHECK (quoted_on IS NULL OR date(quoted_on) IS NOT NULL),
  status TEXT NOT NULL CHECK (status IN ('Confirmado', 'Estimado', 'Pendente', 'Desatualizado')),
  source TEXT,
  notes TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ingredient_quotes_by_ingredient ON ingredient_quotes(ingredient_id, quoted_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ingredient_one_current_quote ON ingredient_quotes(ingredient_id) WHERE is_current = 1;

CREATE TABLE IF NOT EXISTS recipes (
  recipe_id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  version TEXT NOT NULL,
  yield_units INTEGER NOT NULL CHECK (yield_units > 0),
  source TEXT,
  instructions TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recipes_by_product ON recipes(product_name, version);

CREATE TABLE IF NOT EXISTS recipe_lines (
  line_id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(recipe_id),
  ingredient_id TEXT NOT NULL REFERENCES ingredients(ingredient_id),
  quantity TEXT NOT NULL CHECK (CAST(quantity AS REAL) >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'un')),
  stage TEXT
);
CREATE INDEX IF NOT EXISTS recipe_lines_by_recipe ON recipe_lines(recipe_id);

CREATE TABLE IF NOT EXISTS parameters (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  unit TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_mix (
  recipe_id TEXT PRIMARY KEY REFERENCES recipes(recipe_id),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  selected_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  ledger_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('sale', 'purchase', 'expense', 'adjustment')),
  occurred_on TEXT NOT NULL CHECK (date(occurred_on) IS NOT NULL),
  occurred_at TEXT,
  recorded_at TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  counterparty TEXT,
  notes TEXT,
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  correction_of TEXT REFERENCES ledger_entries(ledger_id),
  correction_reason TEXT,
  import_id TEXT
);
CREATE INDEX IF NOT EXISTS ledger_by_date_type ON ledger_entries(occurred_on, entry_type);
CREATE INDEX IF NOT EXISTS ledger_by_correction ON ledger_entries(correction_of) WHERE correction_of IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales (
  sale_id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(ledger_id),
  gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
  fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0),
  net_cents INTEGER NOT NULL CHECK (net_cents >= 0),
  customer TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  CHECK (gross_cents - fee_cents = net_cents)
);

CREATE TABLE IF NOT EXISTS sale_items (
  item_id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(sale_id),
  product_id TEXT REFERENCES products(product_id),
  product_name_snapshot TEXT NOT NULL,
  category_snapshot TEXT NOT NULL,
  quantity TEXT NOT NULL CHECK (CAST(quantity AS REAL) > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  UNIQUE (source_system, source_id)
);
CREATE INDEX IF NOT EXISTS sale_items_by_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS sale_items_by_product ON sale_items(product_id);

CREATE TABLE IF NOT EXISTS sale_payments (
  payment_id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(sale_id),
  method TEXT NOT NULL CHECK (method IN ('Dinheiro', 'Débito', 'Crédito', 'Pix', 'Outro')),
  method_label TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  fee_rate TEXT NOT NULL,
  fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0),
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  UNIQUE (source_system, source_id)
);
CREATE INDEX IF NOT EXISTS sale_payments_by_sale ON sale_payments(sale_id);

CREATE TABLE IF NOT EXISTS purchases (
  purchase_id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(ledger_id),
  supplier TEXT,
  payment_method TEXT,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_items (
  item_id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(purchase_id),
  description_snapshot TEXT NOT NULL,
  quantity TEXT CHECK (quantity IS NULL OR CAST(quantity AS REAL) > 0),
  unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  UNIQUE (source_system, source_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  expense_id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(ledger_id),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  payment_method TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_import_lock (
  lock_id INTEGER PRIMARY KEY CHECK (lock_id = 1),
  import_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_imports (
  import_id TEXT PRIMARY KEY,
  contract TEXT NOT NULL,
  contract_version INTEGER NOT NULL,
  source_system TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  row_counts_json TEXT NOT NULL,
  reconciliation_json TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger entries are append-only; add a correction entry'); END;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger entries are append-only; add a correction entry'); END;
CREATE TRIGGER IF NOT EXISTS sales_no_update BEFORE UPDATE ON sales
BEGIN SELECT RAISE(ABORT, 'sales are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS sales_no_delete BEFORE DELETE ON sales
BEGIN SELECT RAISE(ABORT, 'sales are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS sale_items_no_update BEFORE UPDATE ON sale_items
BEGIN SELECT RAISE(ABORT, 'sale items are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS sale_items_no_delete BEFORE DELETE ON sale_items
BEGIN SELECT RAISE(ABORT, 'sale items are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS sale_payments_no_update BEFORE UPDATE ON sale_payments
BEGIN SELECT RAISE(ABORT, 'sale payments are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS sale_payments_no_delete BEFORE DELETE ON sale_payments
BEGIN SELECT RAISE(ABORT, 'sale payments are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS purchases_no_update BEFORE UPDATE ON purchases
BEGIN SELECT RAISE(ABORT, 'purchases are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS purchases_no_delete BEFORE DELETE ON purchases
BEGIN SELECT RAISE(ABORT, 'purchases are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS purchase_items_no_update BEFORE UPDATE ON purchase_items
BEGIN SELECT RAISE(ABORT, 'purchase items are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS purchase_items_no_delete BEFORE DELETE ON purchase_items
BEGIN SELECT RAISE(ABORT, 'purchase items are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS expenses_no_update BEFORE UPDATE ON expenses
BEGIN SELECT RAISE(ABORT, 'expenses are immutable snapshots'); END;
CREATE TRIGGER IF NOT EXISTS expenses_no_delete BEFORE DELETE ON expenses
BEGIN SELECT RAISE(ABORT, 'expenses are immutable snapshots'); END;
