export interface D1ImportBundle {
  contract: "sabores-da-canastra/d1-import";
  contract_version: 1;
  import_id: string;
  source: Record<string, unknown>;
  row_counts: Record<string, number>;
  reconciliation: Record<string, unknown>;
  tables: Record<string, Record<string, unknown>[]>;
}

type ImportTable = {
  table: string;
  columns: string[];
  rows: (bundle: D1ImportBundle) => Record<string, unknown>[];
};

const IMPORT_TABLES: ImportTable[] = [
  {
    table: "categories",
    columns: ["category_id", "name", "created_at"],
    rows: (b) => b.tables.categories,
  },
  {
    table: "products",
    columns: [
      "product_id",
      "barcode",
      "auxiliary_code",
      "name",
      "category_id",
      "unit",
      "sale_price_cents",
      "unit_cost_cents",
      "active",
      "notes",
      "created_at",
      "updated_at",
    ],
    rows: (b) => b.tables.products,
  },
  {
    table: "ingredients",
    columns: [
      "ingredient_id",
      "name",
      "base_unit",
      "pack_quantity",
      "supplier",
      "notes",
      "created_at",
      "updated_at",
    ],
    rows: (b) => b.tables.ingredients,
  },
  {
    table: "ingredient_quotes",
    columns: [
      "quote_id",
      "ingredient_id",
      "pack_price_cents",
      "pack_quantity",
      "base_unit",
      "supplier",
      "quoted_on",
      "status",
      "source",
      "notes",
      "is_current",
      "created_at",
    ],
    rows: (b) => b.tables.quotes,
  },
  {
    table: "recipes",
    columns: [
      "recipe_id",
      "product_name",
      "version",
      "yield_units",
      "source",
      "instructions",
      "created_at",
      "updated_at",
    ],
    rows: (b) => b.tables.recipes,
  },
  {
    table: "recipe_lines",
    columns: [
      "line_id",
      "recipe_id",
      "ingredient_id",
      "quantity",
      "unit",
      "stage",
    ],
    rows: (b) => b.tables.recipeLines,
  },
  {
    table: "parameters",
    columns: ["name", "value", "unit", "status", "updated_at"],
    rows: (b) => b.tables.parameters,
  },
  {
    table: "daily_mix",
    columns: ["recipe_id", "quantity", "selected_version"],
    rows: (b) => b.tables.dailyMix,
  },
  {
    table: "ledger_entries",
    columns: [
      "ledger_id",
      "idempotency_key",
      "entry_type",
      "occurred_on",
      "occurred_at",
      "recorded_at",
      "amount_cents",
      "currency",
      "description",
      "category",
      "counterparty",
      "notes",
      "source_system",
      "source_id",
      "correction_of",
      "correction_reason",
      "import_id",
    ],
    rows: (b) => b.tables.ledgerEntries,
  },
  {
    table: "sales",
    columns: [
      "sale_id",
      "ledger_id",
      "gross_cents",
      "fee_cents",
      "net_cents",
      "customer",
      "notes",
      "created_at",
    ],
    rows: (b) => b.tables.sales,
  },
  {
    table: "sale_items",
    columns: [
      "item_id",
      "sale_id",
      "product_id",
      "product_name_snapshot",
      "category_snapshot",
      "quantity",
      "unit_price_cents",
      "unit_cost_cents",
      "line_total_cents",
      "source_system",
      "source_id",
    ],
    rows: (b) => b.tables.saleItems,
  },
  {
    table: "sale_payments",
    columns: [
      "payment_id",
      "sale_id",
      "method",
      "method_label",
      "amount_cents",
      "fee_rate",
      "fee_cents",
      "source_system",
      "source_id",
    ],
    rows: (b) => b.tables.salePayments,
  },
  {
    table: "purchases",
    columns: [
      "purchase_id",
      "ledger_id",
      "supplier",
      "payment_method",
      "total_cents",
      "notes",
      "created_at",
    ],
    rows: (b) => b.tables.purchases,
  },
  {
    table: "purchase_items",
    columns: [
      "item_id",
      "purchase_id",
      "description_snapshot",
      "quantity",
      "unit_price_cents",
      "line_total_cents",
      "source_system",
      "source_id",
    ],
    rows: (b) => b.tables.purchaseItems,
  },
  {
    table: "expenses",
    columns: [
      "expense_id",
      "ledger_id",
      "category",
      "description",
      "payment_method",
      "amount_cents",
      "notes",
      "created_at",
    ],
    rows: (b) => b.tables.expenses,
  },
];

const jsonFields: Record<string, string[]> = {
  categories: ["categoryId", "name", "createdAt"],
  products: [
    "productId",
    "barcode",
    "auxiliaryCode",
    "name",
    "categoryId",
    "unit",
    "salePriceCents",
    "unitCostCents",
    "active",
    "notes",
    "createdAt",
    "updatedAt",
  ],
  ingredients: [
    "ingredientId",
    "name",
    "baseUnit",
    "packQuantity",
    "supplier",
    "notes",
    "createdAt",
    "updatedAt",
  ],
  ingredient_quotes: [
    "quoteId",
    "ingredientId",
    "packPriceCents",
    "packQuantity",
    "baseUnit",
    "supplier",
    "quotedOn",
    "status",
    "source",
    "notes",
    "isCurrent",
    "createdAt",
  ],
  recipes: [
    "recipeId",
    "productName",
    "version",
    "yieldUnits",
    "source",
    "instructions",
    "createdAt",
    "updatedAt",
  ],
  recipe_lines: [
    "lineId",
    "recipeId",
    "ingredientId",
    "quantity",
    "unit",
    "stage",
  ],
  parameters: ["name", "value", "unit", "status", "updatedAt"],
  daily_mix: ["recipeId", "quantity", "selectedVersion"],
  ledger_entries: [
    "ledgerId",
    "idempotencyKey",
    "entryType",
    "occurredOn",
    "occurredAt",
    "recordedAt",
    "amountCents",
    "currency",
    "description",
    "category",
    "counterparty",
    "notes",
    "sourceSystem",
    "sourceId",
    "correctionOf",
    "correctionReason",
    "importId",
  ],
  sales: [
    "saleId",
    "ledgerId",
    "grossCents",
    "feeCents",
    "netCents",
    "customer",
    "notes",
    "createdAt",
  ],
  sale_items: [
    "itemId",
    "saleId",
    "productId",
    "productNameSnapshot",
    "categorySnapshot",
    "quantity",
    "unitPriceCents",
    "unitCostCents",
    "lineTotalCents",
    "sourceSystem",
    "sourceId",
  ],
  sale_payments: [
    "paymentId",
    "saleId",
    "method",
    "methodLabel",
    "amountCents",
    "feeRate",
    "feeCents",
    "sourceSystem",
    "sourceId",
  ],
  purchases: [
    "purchaseId",
    "ledgerId",
    "supplier",
    "paymentMethod",
    "totalCents",
    "notes",
    "createdAt",
  ],
  purchase_items: [
    "itemId",
    "purchaseId",
    "descriptionSnapshot",
    "quantity",
    "unitPriceCents",
    "lineTotalCents",
    "sourceSystem",
    "sourceId",
  ],
  expenses: [
    "expenseId",
    "ledgerId",
    "category",
    "description",
    "paymentMethod",
    "amountCents",
    "notes",
    "createdAt",
  ],
};

const sourceRows = (bundle: D1ImportBundle, table: string) => {
  const map: Record<string, string> = {
    categories: "categories",
    products: "products",
    ingredients: "ingredients",
    ingredient_quotes: "quotes",
    recipes: "recipes",
    recipe_lines: "recipeLines",
    parameters: "parameters",
    daily_mix: "dailyMix",
    ledger_entries: "ledgerEntries",
    sales: "sales",
    sale_items: "saleItems",
    sale_payments: "salePayments",
    purchases: "purchases",
    purchase_items: "purchaseItems",
    expenses: "expenses",
  };
  return bundle.tables[map[table]] ?? [];
};

function validateBundle(value: unknown): asserts value is D1ImportBundle {
  if (!value || typeof value !== "object")
    throw new Error("O pacote deve ser um objeto JSON.");
  const bundle = value as Partial<D1ImportBundle>;
  if (
    bundle.contract !== "sabores-da-canastra/d1-import" ||
    bundle.contract_version !== 1
  )
    throw new Error("Contrato de migração incompatível.");
  if (
    typeof bundle.import_id !== "string" ||
    !/^[a-f0-9]{64}$/.test(bundle.import_id)
  )
    throw new Error("import_id inválido.");
  if (!bundle.tables || typeof bundle.tables !== "object")
    throw new Error("tables ausente.");
  for (const table of IMPORT_TABLES) {
    const rows = sourceRows(bundle as D1ImportBundle, table.table);
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
    )
      throw new Error(
        `Tabela ${table.table} precisa ser uma lista de objetos.`,
      );
  }
  if (!bundle.row_counts || !bundle.reconciliation || !bundle.source)
    throw new Error("Resumo, origem ou conciliação ausentes.");
  for (const field of [
    "sqlite_data_sha256",
    "workbook_sha256",
    "source_digest",
  ] as const) {
    if (
      typeof bundle.source[field] !== "string" ||
      !/^[a-f0-9]{64}$/.test(bundle.source[field] as string)
    )
      throw new Error(`Hash de origem inválido: ${field}.`);
  }
  for (const row of bundle.tables.ledgerEntries ?? []) {
    if (!Number.isSafeInteger(row.amountCents) || Number(row.amountCents) < 0)
      throw new Error("Ledger contém valor negativo ou inválido.");
    if (
      typeof row.occurredOn !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.occurredOn)
    )
      throw new Error("Ledger contém data inválida.");
  }
  const countKeys: Record<string, string> = {
    categories: "categories",
    products: "products",
    ingredients: "ingredients",
    quotes: "quotes",
    recipes: "recipes",
    recipeLines: "recipeLines",
    parameters: "parameters",
    dailyMix: "dailyMix",
    ledgerEntries: "ledgerEntries",
    sales: "sales",
    saleItems: "saleItems",
    salePayments: "salePayments",
    purchases: "purchases",
    purchaseItems: "purchaseItems",
    expenses: "expenses",
  };
  for (const [countKey, tableKey] of Object.entries(countKeys)) {
    if (bundle.row_counts[countKey] !== bundle.tables[tableKey].length)
      throw new Error(`Contagem informada não confere para ${tableKey}.`);
  }
  const itemTotals = new Map<string, number>();
  for (const item of bundle.tables.saleItems ?? []) {
    const amount = Number(item.lineTotalCents);
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new Error("Item de venda contém total inválido.");
    itemTotals.set(
      String(item.saleId),
      (itemTotals.get(String(item.saleId)) ?? 0) + amount,
    );
  }
  const paymentTotals = new Map<string, { amount: number; fee: number }>();
  for (const payment of bundle.tables.salePayments ?? []) {
    const amount = Number(payment.amountCents);
    const fee = Number(payment.feeCents);
    if (
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      !Number.isSafeInteger(fee) ||
      fee < 0
    )
      throw new Error("Pagamento contém valor ou taxa inválidos.");
    const totals = paymentTotals.get(String(payment.saleId)) ?? {
      amount: 0,
      fee: 0,
    };
    totals.amount += amount;
    totals.fee += fee;
    paymentTotals.set(String(payment.saleId), totals);
  }
  for (const sale of bundle.tables.sales ?? []) {
    const gross = Number(sale.grossCents);
    const fee = Number(sale.feeCents);
    const net = Number(sale.netCents);
    const payments = paymentTotals.get(String(sale.saleId));
    if (
      !Number.isSafeInteger(gross) ||
      !Number.isSafeInteger(fee) ||
      !Number.isSafeInteger(net) ||
      gross < 0 ||
      fee < 0 ||
      gross - fee !== net
    )
      throw new Error(`Venda ${String(sale.saleId)} possui totais inválidos.`);
    if (itemTotals.get(String(sale.saleId)) !== gross)
      throw new Error(
        `Itens da venda ${String(sale.saleId)} não conciliam com o bruto.`,
      );
    if (!payments || payments.amount !== gross || payments.fee !== fee)
      throw new Error(
        `Pagamentos da venda ${String(sale.saleId)} não conciliam com bruto/taxas.`,
      );
  }
  const reconciliation = bundle.reconciliation as {
    financial?: Record<string, { matches?: boolean }>;
  };
  if (
    Object.values(reconciliation.financial ?? {}).some(
      (line) => line.matches !== true,
    )
  )
    throw new Error("A reconciliação financeira do pacote contém diferenças.");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalJson(item)]),
    );
  }
  return value;
}

async function sha256(value: Uint8Array) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    value as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function calculateBundleIntegrity(bundle: D1ImportBundle) {
  const stableTables = structuredClone(bundle.tables);
  for (const rows of Object.values(stableTables)) {
    for (const row of rows) {
      delete row.createdAt;
      delete row.updatedAt;
      delete row.recordedAt;
    }
  }
  for (const row of stableTables.ledgerEntries ?? []) row.importId = null;
  const encoder = new TextEncoder();
  const stableBytes = encoder.encode(
    JSON.stringify(canonicalJson(stableTables)),
  );
  const sqliteDataDigest = await sha256(stableBytes);
  const workbookDigest = String(bundle.source.workbook_sha256);
  const combined = new Uint8Array(
    stableBytes.length + encoder.encode(workbookDigest).length,
  );
  combined.set(stableBytes);
  combined.set(encoder.encode(workbookDigest), stableBytes.length);
  const sourceDigest = await sha256(combined);
  const importId = await sha256(
    encoder.encode(
      `${bundle.contract}:${bundle.contract_version}:${sourceDigest}`,
    ),
  );
  return {
    sqlite_data_sha256: sqliteDataDigest,
    source_digest: sourceDigest,
    import_id: importId,
  };
}

export function prepareImportStatements(
  db: D1Database,
  value: unknown,
  importedAt: string,
) {
  validateBundle(value);
  const bundle = value;
  const statements = [
    db
      .prepare(
        "INSERT INTO legacy_import_lock (lock_id, import_id, created_at) VALUES (1, ?, ?)",
      )
      .bind(bundle.import_id, importedAt),
  ];
  statements.push(
    ...IMPORT_TABLES.map(({ table, columns }) => {
      const names = jsonFields[table];
      const select = names
        .map((name) => `json_extract(value, '$.${name}')`)
        .join(", ");
      const sql = `INSERT INTO ${table} (${columns.join(", ")}) SELECT ${select} FROM json_each(?)`;
      return db.prepare(sql).bind(JSON.stringify(sourceRows(bundle, table)));
    }),
  );
  const importRecord = [
    {
      importId: bundle.import_id,
      contract: bundle.contract,
      contractVersion: bundle.contract_version,
      sourceSystem: "python-sqlite-and-workbook",
      sourceDigest: String(bundle.source.source_digest ?? ""),
      importedAt,
      rowCountsJson: JSON.stringify(bundle.row_counts),
      reconciliationJson: JSON.stringify(bundle.reconciliation),
    },
  ];
  statements.push(
    db
      .prepare(
        `INSERT INTO data_imports (import_id, contract, contract_version, source_system, source_digest, imported_at, row_counts_json, reconciliation_json)
		SELECT json_extract(value, '$.importId'), json_extract(value, '$.contract'), json_extract(value, '$.contractVersion'), json_extract(value, '$.sourceSystem'), json_extract(value, '$.sourceDigest'), json_extract(value, '$.importedAt'), json_extract(value, '$.rowCountsJson'), json_extract(value, '$.reconciliationJson') FROM json_each(?)`,
      )
      .bind(JSON.stringify(importRecord)),
  );
  return statements;
}

export async function importBundle(db: D1Database, value: unknown) {
  validateBundle(value);
  const bundle = value;
  const integrity = await calculateBundleIntegrity(bundle);
  if (
    integrity.sqlite_data_sha256 !== bundle.source.sqlite_data_sha256 ||
    integrity.source_digest !== bundle.source.source_digest ||
    integrity.import_id !== bundle.import_id
  )
    throw new Error(
      "Hash do pacote não confere com os dados; gere novamente o preview.",
    );
  const prior = await db
    .prepare("SELECT import_id FROM data_imports WHERE import_id = ?")
    .bind(bundle.import_id)
    .first();
  if (prior)
    return {
      importId: bundle.import_id,
      alreadyImported: true,
      rowCounts: bundle.row_counts,
    };
  const target = await db
    .prepare(
      `SELECT
		(SELECT COUNT(*) FROM categories) + (SELECT COUNT(*) FROM products) +
		(SELECT COUNT(*) FROM ingredients) + (SELECT COUNT(*) FROM ingredient_quotes) +
		(SELECT COUNT(*) FROM recipes) + (SELECT COUNT(*) FROM recipe_lines) +
		(SELECT COUNT(*) FROM parameters) + (SELECT COUNT(*) FROM daily_mix) +
		(SELECT COUNT(*) FROM ledger_entries) + (SELECT COUNT(*) FROM sales) +
		(SELECT COUNT(*) FROM sale_items) + (SELECT COUNT(*) FROM sale_payments) +
		(SELECT COUNT(*) FROM purchases) + (SELECT COUNT(*) FROM purchase_items) +
		(SELECT COUNT(*) FROM expenses) + (SELECT COUNT(*) FROM data_imports) +
		(SELECT COUNT(*) FROM legacy_import_lock) AS existing_rows`,
    )
    .first<{ existing_rows: number }>();
  if (Number(target?.existing_rows ?? 0) > 0)
    throw new Error(
      "D1 já contém dados sem o mesmo import_id; interrompido para evitar sobrescrita ou mescla ambígua.",
    );
  const results = await db.batch(
    prepareImportStatements(db, bundle, new Date().toISOString()),
  );
  if (results.some((result) => !result.success))
    throw new Error("D1 recusou o lote; nenhuma linha foi confirmada.");
  return {
    importId: bundle.import_id,
    alreadyImported: false,
    rowCounts: bundle.row_counts,
  };
}
