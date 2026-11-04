import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";
import {
  backupExpired,
  backupPrefix,
  backupRetentionDays,
  hashStream,
  initialExportState,
  putImmutableBackupStream,
  putImmutableBackupObject,
} from "../src/backup";
import { validateSale } from "../src/sales";
import {
  operationPayloadHash,
  type OperationEnvelope,
  type SaleCreatePayload,
} from "@sabores/pdv-sync";

const bindings = env as unknown as Cloudflare.Env;
const payload = {
  occurred_on: "2026-11-01",
  items: [
    {
      name: "Produto de teste",
      category: "Teste",
      quantity: 2,
      unit_price_cents: 1250,
      unit_cost_cents: 500,
    },
  ],
  payments: [
    {
      method: "Dinheiro" as const,
      amount_cents: 2500,
      fee_rate: 0,
      fee_cents: 0,
    },
  ],
};
const testActorId = "test-ledger-actor";
const backupTestUserId = "backup-test-user";
async function backupCredentialFingerprint(
  userId = backupTestUserId,
  role = "owner",
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        userId,
        userId,
        role,
        "AAAAAAAAAAAAAAAAAAAAAA",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        100_000,
      ]),
    ),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function ensureTestActor() {
  await bindings.DB.prepare(
    "INSERT OR IGNORE INTO auth_users (user_id, username, role, active, created_at) VALUES (?, ?, 'owner', 1, ?)",
  )
    .bind(testActorId, "ledger-test-user", new Date().toISOString())
    .run();
}

async function makeOfflineOperation(): Promise<OperationEnvelope> {
  await ensureTestActor();
  const categoryId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const name = `Produto PDV ${productId}`;
  await bindings.DB.prepare(
    "INSERT INTO categories (category_id, name, created_at) VALUES (?, ?, ?)",
  )
    .bind(categoryId, `Categoria ${categoryId}`, new Date().toISOString())
    .run();
  await bindings.DB.prepare(
    `INSERT INTO products
       (product_id, name, category_id, unit, sale_price_cents, unit_cost_cents,
        active, created_at, updated_at)
     VALUES (?, ?, ?, 'un', 2500, 500, 1, ?, ?)`,
  )
    .bind(
      productId,
      name,
      categoryId,
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  const operation: OperationEnvelope = {
    operationId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    actor: { userId: testActorId, label: "ledger-test-user" },
    operationType: "sale.create",
    occurredAt: new Date().toISOString(),
    clientCreatedAt: new Date().toISOString(),
    catalogVersion: "test-catalog-v1",
    hashVersion: "pdv-op/v1",
    payloadHash: "0".repeat(64),
    payload: {
      saleId: "pending",
      occurredOn: new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      customer: null,
      notes: null,
      items: [
        {
          productId,
          name,
          category: `Categoria ${categoryId}`,
          quantity: "1",
          unitPriceCents: 2500,
          unitCostCents: 500,
          lineTotalCents: 2500,
          position: 0,
        },
      ],
      splits: [{ partNumber: 1, dueCents: 2500 }],
      payments: [
        {
          method: "Dinheiro",
          methodLabel: null,
          amountCents: 2500,
          feeRate: "0",
          feeCents: 0,
          partNumber: 1,
          position: 0,
        },
      ],
    },
  };
  operation.payload.saleId = `pdv-sale:${operation.operationId}`;
  operation.payloadHash = await operationPayloadHash(operation);
  return operation;
}

async function authenticatedCookie(role = "owner") {
  const userId = role === "owner" ? backupTestUserId : "operator-test-user";
  const token = crypto.randomUUID() + crypto.randomUUID();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const tokenHash = [...new Uint8Array(digest)]
    .map((byte) => String.fromCharCode(byte))
    .join("");
  const encodedHash = btoa(tokenHash)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  await bindings.DB.prepare(
    "INSERT INTO auth_users (user_id, username, role, active, created_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET active = 1, role = excluded.role",
  )
    .bind(userId, userId, role, new Date().toISOString())
    .run();
  await bindings.DB.prepare(
    `INSERT OR REPLACE INTO users
      (user_id, username, role, salt, password_hash, iterations, active, created_at, updated_at)
     VALUES (?, ?, ?, 'AAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 100000, 1, ?, ?)`,
  )
    .bind(
      userId,
      userId,
      role,
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  await bindings.DB.prepare(
    "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, credential_fingerprint) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      encodedHash,
      userId,
      new Date().toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
      await backupCredentialFingerprint(userId, role),
    )
    .run();
  return `sabores_session=${token}`;
}

describe("bindings Cloudflare locais", () => {
  it("resolve custo manual, mix e receita e congela o custo do servidor sem alterar o hash offline", async () => {
    const { resolveProductCosts } = await import("../src/product-cost");
    const { applyPdvOperation } = await import("../src/pdv-operations");
    const operation = await makeOfflineOperation();
    const item = (operation.payload as SaleCreatePayload).items[0]!;
    const productId = item.productId;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await bindings.DB.batch([
      bindings.DB.prepare(
        "UPDATE products SET unit_cost_cents = NULL WHERE product_id = ?",
      ).bind(productId),
      bindings.DB.prepare(
        "INSERT INTO ingredients (ingredient_id, name, base_unit, pack_quantity, created_at, updated_at) VALUES (?, ?, 'g', '1000', ?, ?)",
      ).bind(id, id, now, now),
      bindings.DB.prepare(
        "INSERT INTO ingredient_quotes (quote_id, ingredient_id, pack_price_cents, pack_quantity, base_unit, status, is_current, created_at) VALUES (?, ?, 1000, '1000', 'g', 'Confirmado', 1, ?)",
      ).bind(id, id, now),
      ...["A", "Z"].flatMap((version, index) => [
        bindings.DB.prepare(
          "INSERT INTO recipes (recipe_id, product_id, product_name, version, yield_units, created_at, updated_at) VALUES (?, ?, ?, ?, 2, ?, ?)",
        ).bind(`${id}-${version}`, productId, item.name, version, now, now),
        bindings.DB.prepare(
          "INSERT INTO recipe_lines (line_id, recipe_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, ?, 'g')",
        ).bind(
          `${id}-${version}`,
          `${id}-${version}`,
          id,
          String(100 * (index + 1)),
        ),
      ]),
    ]);
    const product = {
      product_id: productId,
      name: item.name,
      unit_cost_cents: null,
    };
    const resolve = async () =>
      (await resolveProductCosts(bindings.DB, [product])).get(productId);
    expect(await resolve()).toMatchObject({
      unit_cost_cents: 50,
      cost_source: "recipe",
      cost_recipe_id: `${id}-A`,
    });
    await bindings.DB.prepare(
      "INSERT INTO daily_mix (recipe_id, quantity, selected_version) VALUES (?, 1, 'Z')",
    )
      .bind(`${id}-Z`)
      .run();
    expect(await resolve()).toMatchObject({
      unit_cost_cents: 100,
      cost_recipe_id: `${id}-Z`,
    });
    expect(
      (
        await resolveProductCosts(bindings.DB, [
          { ...product, unit_cost_cents: 0 },
        ])
      ).get(productId),
    ).toMatchObject({ unit_cost_cents: 0, cost_source: "manual" });
    await bindings.DB.prepare(
      "UPDATE ingredient_quotes SET status = 'Pendente' WHERE quote_id = ?",
    )
      .bind(id)
      .run();
    expect(await resolve()).toMatchObject({
      unit_cost_cents: null,
      cost_source: "pending",
    });
    await bindings.DB.prepare(
      "UPDATE ingredient_quotes SET status = 'Estimado' WHERE quote_id = ?",
    )
      .bind(id)
      .run();
    expect(await resolve()).toMatchObject({
      unit_cost_cents: 100,
      cost_quality: "Estimado",
    });
    const cookie = await authenticatedCookie();
    const catalog = await (
      await app.request(
        "https://api.example.test/api/pdv/catalog",
        { headers: { cookie } },
        bindings,
      )
    ).json<{ data: { product_id: string; unit_cost_cents: number }[] }>();
    expect(
      catalog.data.find((p) => p.product_id === productId)?.unit_cost_cents,
    ).toBe(100);
    item.unitCostCents = 999999;
    operation.payloadHash = await operationPayloadHash(operation);
    const originalHash = operation.payloadHash;
    await applyPdvOperation(bindings.DB, operation, testActorId);
    await bindings.DB.prepare(
      "UPDATE ingredient_quotes SET pack_price_cents = 2000 WHERE quote_id = ?",
    )
      .bind(id)
      .run();
    expect(await resolve()).toMatchObject({ unit_cost_cents: 200 });
    expect(
      (await applyPdvOperation(bindings.DB, operation, testActorId)).replayed,
    ).toBe(true);
    expect(
      await bindings.DB.prepare(
        "SELECT unit_cost_cents FROM sale_items WHERE item_id = ?",
      )
        .bind(`${operation.operationId}:item:0`)
        .first(),
    ).toEqual({ unit_cost_cents: 100 });
    expect(
      await bindings.DB.prepare(
        "SELECT payload_hash FROM sync_operations WHERE operation_id = ?",
      )
        .bind(operation.operationId)
        .first(),
    ).toEqual({ payload_hash: originalHash });
  });

  it("rejeita datas inexistentes no financeiro e aceita dia bissexto real", async () => {
    const cookie = await authenticatedCookie();
    for (const query of [
      "from=2026-02-31&to=2026-03-02",
      "from=2026-01-01&to=2026-02-30",
      "from=2026-03-01&to=2026-02-01",
      "from=2026-2-1&to=2026-03-01",
    ]) {
      expect(
        (
          await app.request(
            `https://api.example.test/api/erp/finance?${query}`,
            { headers: { cookie } },
            bindings,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await app.request(
          "https://api.example.test/api/erp/finance?from=2024-02-29&to=2024-02-29",
          { headers: { cookie } },
          bindings,
        )
      ).status,
    ).toBe(200);
  });
  it("identifica o lançamento cancelado sem removê-lo da auditoria", async () => {
    const { applyPdvOperation } = await import("../src/pdv-operations");
    const sale = await makeOfflineOperation();
    await applyPdvOperation(bindings.DB, sale, testActorId);
    const cancellation: OperationEnvelope = {
      ...sale,
      operationId: crypto.randomUUID(),
      operationType: "sale.cancel",
      payload: { saleId: sale.payload.saleId, reason: "Cancelamento de teste" },
    };
    cancellation.payloadHash = await operationPayloadHash(cancellation);
    await applyPdvOperation(bindings.DB, cancellation, testActorId);
    const occurredOn = (sale.payload as SaleCreatePayload).occurredOn;
    const response = await app.request(
      `https://api.example.test/api/finance/entries?from=${occurredOn}&to=${occurredOn}&type=sale`,
      { headers: { cookie: await authenticatedCookie() } },
      bindings,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      data: { ledger_id: string; cancelled: number }[];
    }>();
    expect(
      body.data.find(
        (row) => row.ledger_id === `ledger_pdv_${sale.operationId}`,
      ),
    ).toMatchObject({ cancelled: 1 });
  });
  it("isola overflow de custo sem derrubar as outras receitas", async () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await bindings.DB.batch([
      bindings.DB.prepare(
        "INSERT INTO ingredients (ingredient_id, name, base_unit, pack_quantity, created_at, updated_at) VALUES (?, ?, 'g', '0.000000001', ?, ?)",
      ).bind(id, id, now, now),
      bindings.DB.prepare(
        "INSERT INTO ingredient_quotes (quote_id, ingredient_id, pack_price_cents, pack_quantity, base_unit, status, is_current, created_at) VALUES (?, ?, 9007199254740991, '0.000000001', 'g', 'Confirmado', 1, ?)",
      ).bind(id, id, now),
      ...["huge", "normal"].flatMap((kind) => [
        bindings.DB.prepare(
          "INSERT INTO recipes (recipe_id, product_name, version, yield_units, created_at, updated_at) VALUES (?, ?, '1', 1, ?, ?)",
        ).bind(`${id}-${kind}`, `${id}-${kind}`, now, now),
        bindings.DB.prepare(
          "INSERT INTO recipe_lines (line_id, recipe_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, ?, 'g')",
        ).bind(
          `${id}-${kind}`,
          `${id}-${kind}`,
          id,
          kind === "huge" ? "1000" : "0",
        ),
      ]),
    ]);
    const response = await app.request(
      "https://api.example.test/api/erp/recipes",
      { headers: { cookie: await authenticatedCookie() } },
      bindings,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      data: {
        recipe_id: string;
        cost_error?: string;
        unit_cost_cents: number | null;
      }[];
    }>();
    expect(body.data.find((r) => r.recipe_id === `${id}-huge`)).toMatchObject({
      cost_error: "CUSTO_EXCESSIVO",
      unit_cost_cents: null,
    });
    expect(body.data.find((r) => r.recipe_id === `${id}-normal`)).toMatchObject(
      { unit_cost_cents: 0 },
    );
  });
  it("mantém o vínculo da receita ao renomear produto e substitui linhas somente com dados válidos", async () => {
    const cookie = await authenticatedCookie();
    const call = (path: string, method: string, body?: unknown) =>
      app.request(
        `https://api.example.test/api/admin/${path}`,
        {
          method,
          headers: {
            cookie,
            origin: "https://erp.example.test",
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        { ...bindings, AUTH_ALLOWED_ORIGINS: "https://erp.example.test" },
      );
    const suffix = crypto.randomUUID();
    const now = new Date().toISOString();
    const product = `product-${suffix}`;
    const ingredient = `ingredient-${suffix}`;
    await bindings.DB.batch([
      bindings.DB.prepare(
        "INSERT INTO categories (category_id, name, created_at) VALUES (?, ?, ?)",
      ).bind(suffix, suffix, now),
      bindings.DB.prepare(
        "INSERT INTO products (product_id, name, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(product, suffix, suffix, now, now),
      bindings.DB.prepare(
        "INSERT INTO ingredients (ingredient_id, name, base_unit, pack_quantity, created_at, updated_at) VALUES (?, ?, 'g', '1000', ?, ?)",
      ).bind(ingredient, suffix, now, now),
      bindings.DB.prepare(
        "INSERT INTO ingredient_quotes (quote_id, ingredient_id, pack_price_cents, pack_quantity, base_unit, status, is_current, created_at) VALUES (?, ?, 1000, '1000', 'g', 'Confirmado', 1, ?)",
      ).bind(suffix, ingredient, now),
    ]);
    const payload = {
      product_id: product,
      product_name: suffix,
      version: "1",
      yield_units: 2,
      source: null,
      instructions: "Misturar",
      lines: [
        { ingredient_id: ingredient, quantity: "100", unit: "g", stage: null },
      ],
    };
    for (const invalid of [
      { lines: [] },
      { yield_units: 0 },
      { lines: [{ ...payload.lines[0], unit: "ml" }] },
      { lines: [{ ...payload.lines[0], quantity: "-1" }] },
      { product_id: "inexistente" },
    ]) {
      expect(
        (await call("recipes", "POST", { ...payload, ...invalid })).status,
      ).toBe(422);
    }
    const created = await call("recipes", "POST", payload);
    expect(created.status).toBe(201);
    const { recipe_id: id } = await created.json<{ recipe_id: string }>();
    await bindings.DB.prepare(
      "UPDATE products SET name = ? WHERE product_id = ?",
    )
      .bind(`Renomeado ${suffix}`, product)
      .run();
    const response = await app.request(
      "https://api.example.test/api/erp/recipes",
      { headers: { cookie } },
      bindings,
    );
    const data = await response.json<{
      data: {
        recipe_id: string;
        product_name: string;
        unit_cost_cents: number;
      }[];
    }>();
    expect(data.data.find((r) => r.recipe_id === id)).toMatchObject({
      product_name: `Renomeado ${suffix}`,
      unit_cost_cents: 50,
    });
    expect(
      (
        await call(`recipes/${id}`, "PUT", {
          ...payload,
          lines: [{ ...payload.lines[0], unit: "ml" }],
        })
      ).status,
    ).toBe(422);
    expect(
      await bindings.DB.prepare(
        "SELECT quantity FROM recipe_lines WHERE recipe_id = ?",
      )
        .bind(id)
        .first(),
    ).toEqual({ quantity: "100" });
    expect(
      (
        await call(`recipes/${id}`, "PUT", {
          ...payload,
          yield_units: 4,
          lines: [{ ...payload.lines[0], quantity: "250" }],
        })
      ).status,
    ).toBe(200);
    expect(
      await bindings.DB.prepare(
        "SELECT quantity FROM recipe_lines WHERE recipe_id = ?",
      )
        .bind(id)
        .all(),
    ).toMatchObject({ results: [{ quantity: "250" }] });
    await expect(
      bindings.DB.prepare(
        "INSERT INTO recipe_lines (line_id, recipe_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, '1', 'ml')",
      )
        .bind(crypto.randomUUID(), id, ingredient)
        .run(),
    ).rejects.toThrow("RECIPE_UNIT_MISMATCH");
    expect((await call(`recipes/${id}`, "DELETE")).status).toBe(200);
    expect(
      await bindings.DB.prepare(
        "SELECT COUNT(*) AS count FROM recipe_lines WHERE recipe_id = ?",
      )
        .bind(id)
        .first(),
    ).toEqual({ count: 0 });
    expect((await call(`recipes/${id}`, "DELETE")).status).toBe(404);
  });
  it("edita ingredientes atomicamente e preserva cotações ao recusar unidade ou exclusão referenciada", async () => {
    const owner = await authenticatedCookie();
    const operator = await authenticatedCookie("operator");
    const call = (
      path: string,
      method: string,
      body?: unknown,
      cookie = owner,
      origin = "https://erp.example.test",
    ) =>
      app.request(
        `https://api.example.test/api/admin/ingredients${path}`,
        {
          method,
          headers: { cookie, origin, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        { ...bindings, AUTH_ALLOWED_ORIGINS: "https://erp.example.test" },
      );
    const payload = {
      name: `Ingrediente ${crypto.randomUUID()}`,
      base_unit: "g",
      pack_quantity: "1000",
      pack_price_cents: 1200,
      supplier: "Fornecedor",
      notes: null,
      source: "Cotação",
      status: "Confirmado",
      quoted_on: "2026-11-02",
    };
    expect((await call("", "GET", undefined, operator)).status).toBe(403);
    expect(
      (await call("", "POST", payload, owner, "https://invalid.test")).status,
    ).toBe(403);
    for (const invalid of [
      { pack_quantity: "0" },
      { pack_quantity: "1e6" },
      { base_unit: "kg" },
      { quoted_on: "2026-02-30" },
      { pack_price_cents: -1 },
      { pack_price_cents: null },
    ]) {
      expect((await call("", "POST", { ...payload, ...invalid })).status).toBe(
        422,
      );
    }
    const created = await call("", "POST", payload);
    expect(created.status).toBe(201);
    const { ingredient_id: id } = await created.json<{
      ingredient_id: string;
    }>();
    expect(
      (await call(`/${id}`, "PUT", { ...payload, pack_price_cents: 1400 }))
        .status,
    ).toBe(200);
    const quotes = await bindings.DB.prepare(
      "SELECT pack_price_cents, is_current FROM ingredient_quotes WHERE ingredient_id = ? ORDER BY pack_price_cents",
    )
      .bind(id)
      .all();
    expect(quotes.results).toEqual([
      { pack_price_cents: 1200, is_current: 0 },
      { pack_price_cents: 1400, is_current: 1 },
    ]);
    const recipe = crypto.randomUUID();
    const now = new Date().toISOString();
    await bindings.DB.batch([
      bindings.DB.prepare(
        "INSERT INTO recipes (recipe_id, product_name, version, yield_units, created_at, updated_at) VALUES (?, 'Teste', '1', 1, ?, ?)",
      ).bind(recipe, now, now),
      bindings.DB.prepare(
        "INSERT INTO recipe_lines (line_id, recipe_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, '1', 'g')",
      ).bind(crypto.randomUUID(), recipe, id),
    ]);
    expect(
      (await call(`/${id}`, "PUT", { ...payload, base_unit: "ml" })).status,
    ).toBe(409);
    expect((await call(`/${id}`, "DELETE")).status).toBe(409);
    expect(
      await bindings.DB.prepare(
        "SELECT COUNT(*) AS count FROM ingredient_quotes WHERE ingredient_id = ?",
      )
        .bind(id)
        .first(),
    ).toEqual({ count: 2 });
    expect(
      await bindings.DB.prepare(
        "SELECT base_unit FROM ingredients WHERE ingredient_id = ?",
      )
        .bind(id)
        .first(),
    ).toEqual({ base_unit: "g" });
    const another = await call("", "POST", {
      ...payload,
      name: `Remover ${crypto.randomUUID()}`,
      status: "Pendente",
      pack_price_cents: null,
    });
    const { ingredient_id: removable } = await another.json<{
      ingredient_id: string;
    }>();
    expect((await call(`/${removable}`, "DELETE")).status).toBe(200);
    expect((await call(`/${removable}`, "DELETE")).status).toBe(404);
    expect((await call(`/${removable}`, "PUT", payload)).status).toBe(404);
    const listing = await (
      await call("", "GET")
    ).json<{ data: { ingredient_id: string; pack_price_cents: number }[] }>();
    expect(
      listing.data.find((i) => i.ingredient_id === id)?.pack_price_cents,
    ).toBe(1400);
  });

  it("valida cadastro completo, autorização e colisão de produtos", async () => {
    const owner = await authenticatedCookie();
    const operator = await authenticatedCookie("operator");
    const api = (
      path: string,
      method = "GET",
      body?: unknown,
      cookie = owner,
      origin = "https://erp.example.test",
    ) =>
      app.request(
        `https://api.example.test/api/admin/${path}`,
        {
          method,
          headers: { cookie, origin, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        { ...bindings, AUTH_ALLOWED_ORIGINS: "https://erp.example.test" },
      );
    expect((await api("products", "GET", undefined, operator)).status).toBe(
      403,
    );
    expect(
      (
        await api(
          "categories",
          "POST",
          { name: "Teste" },
          owner,
          "https://invalid.test",
        )
      ).status,
    ).toBe(403);
    const categoryResponse = await api("categories", "POST", {
      name: `Categoria ${crypto.randomUUID()}`,
    });
    expect(categoryResponse.status).toBe(201);
    const category = await categoryResponse.json<{ category_id: string }>();
    const product = {
      name: `Produto ${crypto.randomUUID()}`,
      category_id: category.category_id,
      unit: "un",
      barcode: crypto.randomUUID(),
      auxiliary_code: null,
      sale_price_cents: 1250,
      unit_cost_cents: null,
      active: 1,
      notes: "Observação preservada",
    };
    const saved = await api("products", "POST", product);
    expect(saved.status).toBe(201);
    const { product_id } = await saved.json<{ product_id: string }>();
    expect((await api("products", "POST", product)).status).toBe(409);
    expect(
      (await api(`products/${product_id}`, "PUT", { name: "Incompleto" }))
        .status,
    ).toBe(422);
    expect(
      (await api(`products/${product_id}`, "PUT", { ...product, active: 0 }))
        .status,
    ).toBe(200);
    const row = await bindings.DB.prepare(
      "SELECT active, notes FROM products WHERE product_id = ?",
    )
      .bind(product_id)
      .first();
    expect(row).toMatchObject({ active: 0, notes: "Observação preservada" });
  });
  it("restringe receitas ao proprietário e calcula custo da cotação atual", async () => {
    const suffix = crypto.randomUUID();
    const now = new Date().toISOString();
    const ingredient = `ingredient-${suffix}`;
    const recipe = `recipe-${suffix}`;
    await bindings.DB.batch([
      bindings.DB.prepare(
        "INSERT INTO ingredients (ingredient_id, name, base_unit, pack_quantity, created_at, updated_at) VALUES (?, ?, 'g', '1000', ?, ?)",
      ).bind(ingredient, `Ingrediente ${suffix}`, now, now),
      bindings.DB.prepare(
        "INSERT INTO ingredient_quotes (quote_id, ingredient_id, pack_price_cents, pack_quantity, base_unit, status, is_current, created_at) VALUES (?, ?, 900, '1000', 'g', 'Confirmado', 1, ?)",
      ).bind(`quote-${suffix}`, ingredient, now),
      bindings.DB.prepare(
        "INSERT INTO recipes (recipe_id, product_name, version, yield_units, created_at, updated_at) VALUES (?, ?, '1', 2, ?, ?)",
      ).bind(recipe, `Receita ${suffix}`, now, now),
      bindings.DB.prepare(
        "INSERT INTO recipe_lines (line_id, recipe_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, '250', 'g')",
      ).bind(`line-${suffix}`, recipe, ingredient),
    ]);
    const url = "https://api.example.test/api/erp/recipes";
    expect((await app.request(url, {}, bindings)).status).toBe(401);
    expect(
      (
        await app.request(
          url,
          { headers: { cookie: await authenticatedCookie("operator") } },
          bindings,
        )
      ).status,
    ).toBe(403);
    const response = await app.request(
      url,
      { headers: { cookie: await authenticatedCookie() } },
      bindings,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ data: Array<{ recipe_id: string }> }>();
    expect(body.data.find((row) => row.recipe_id === recipe)).toMatchObject({
      batch_cost_cents: 225,
      unit_cost_cents: 113,
      pending_ingredients: [],
    });
  });
  it("protege backup e lançamentos de operadores e valida datas", async () => {
    const operator = await authenticatedCookie("operator");
    const owner = await authenticatedCookie();
    const request = (path: string, cookie: string) =>
      app.request(
        `https://api.example.test${path}`,
        { headers: { cookie } },
        bindings,
      );
    expect((await request("/api/backups", operator)).status).toBe(403);
    expect(
      (
        await request(
          "/api/finance/entries?from=2026-01-01&to=2026-12-31",
          operator,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "/api/finance/entries?from=2026-02-30&to=2026-12-31",
          owner,
        )
      ).status,
    ).toBe(422);
    const response = await request(
      "/api/finance/entries?from=2026-01-01&to=2026-12-31",
      owner,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      limit: 500,
      truncated: false,
    });
  });
  it("recusa token legado no catálogo antes de consultar D1", async () => {
    const prepare = vi.fn();
    const response = await app.request(
      "https://api.example.test/api/catalog/products",
      { headers: { authorization: "Bearer outro-token" } },
      {
        DB: { prepare },
        CATALOG_CACHE: {},
        CATALOG_READ_TOKEN: "catalog-secret-for-test",
      } as unknown as Cloudflare.Env,
    );
    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("não permite leitura do catálogo somente com token legado", async () => {
    const response = await app.request(
      "https://api.example.test/api/catalog/products",
      { headers: { authorization: "Bearer catalog-secret-for-test" } },
      { ...bindings, CATALOG_READ_TOKEN: "catalog-secret-for-test" },
    );
    expect(response.status).toBe(401);
  });

  it("valida campos opcionais e pagamentos malformados antes de somar", async () => {
    expect(await validateSale({ ...payload, payments: [null] })).toBe(false);
    expect(
      await validateSale({ ...payload, customer: { nome: "cliente" } }),
    ).toBe(false);
    expect(
      await validateSale({
        ...payload,
        items: [{ ...payload.items[0], product_id: [] }],
      }),
    ).toBe(false);
    expect(
      await validateSale({
        ...payload,
        payments: [{ ...payload.payments[0], method_label: 123 }],
      }),
    ).toBe(false);
  });

  it("rejeita product_id sem registro no catálogo e aceita ID existente", async () => {
    const sale = {
      ...payload,
      items: [{ ...payload.items[0], product_id: "product-1" }],
    };
    const all = vi.fn(async () => ({
      results: [] as { product_id: string }[],
    }));
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ all })),
      })),
    } as unknown as D1Database;
    expect(await validateSale(sale, db)).toBe(false);
    all.mockResolvedValue({ results: [{ product_id: "product-1" }] });
    expect(await validateSale(sale, db)).toBe(true);
  });

  it("protege a leitura de preços e custos do catálogo", async () => {
    const prepare = vi.fn();
    const apiBindings = {
      DB: { prepare },
      CATALOG_CACHE: {},
    } as unknown as Cloudflare.Env;
    const unauthorized = await app.request(
      "https://api.example.test/api/catalog/products",
      {},
      apiBindings,
    );
    expect(unauthorized.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("usa KV versionado como cache descartável e invalida sem afetar D1", async () => {
    await bindings.CATALOG_CACHE.delete("catalog:v1:products:active");
    const id = crypto.randomUUID();
    await bindings.DB.prepare(
      "INSERT INTO categories (category_id, name, created_at) VALUES (?, ?, ?)",
    )
      .bind(id, `Categoria ${id}`, new Date().toISOString())
      .run();
    await bindings.DB.prepare(
      `INSERT INTO products
      (product_id, name, category_id, unit, active, created_at, updated_at)
      VALUES (?, ?, ?, 'un', 1, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        `Produto ${id}`,
        id,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
    const { listProducts, invalidateCatalogCache } =
      await import("../src/catalog-cache");
    const first = await listProducts(bindings.DB, bindings.CATALOG_CACHE);
    const second = await listProducts(bindings.DB, bindings.CATALOG_CACHE);
    expect(first.source).toBe("d1");
    expect(second.source).toBe("cache");
    const cachedCatalog = await bindings.CATALOG_CACHE.get(
      "catalog:v1:products:active",
    );
    expect(cachedCatalog).not.toContain("unit_cost_cents");
    await invalidateCatalogCache(bindings.CATALOG_CACHE);
    expect(
      (await listProducts(bindings.DB, bindings.CATALOG_CACHE)).source,
    ).toBe("d1");
  });

  it("grava uma venda uma vez e reproduz a resposta em retries", async () => {
    const operation = await makeOfflineOperation();
    const stub = bindings.SALE_COORDINATOR.get(
      bindings.SALE_COORDINATOR.idFromName(`pdv-device:${operation.deviceId}`),
    );
    const makeRequest = (body: unknown) =>
      new Request("https://coordinator.local/operations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-user-id": testActorId,
        },
        body: JSON.stringify(body),
      });
    const first = await stub.fetch(makeRequest(operation));
    const replay = await stub.fetch(makeRequest(operation));
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect((await replay.json<{ replayed: boolean }>()).replayed).toBe(true);
    const count = await bindings.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM sales
       INNER JOIN ledger_entries USING (ledger_id)
       WHERE ledger_entries.idempotency_key = ?`,
    )
      .bind(`pdv:sale.create:${operation.operationId}`)
      .first<{ total: number }>();
    expect(count?.total).toBe(1);
    const actor = await bindings.DB.prepare(
      "SELECT actor_user_id FROM ledger_entries WHERE idempotency_key = ?",
    )
      .bind(`pdv:sale.create:${operation.operationId}`)
      .first<{ actor_user_id: string }>();
    expect(actor?.actor_user_id).toBe(testActorId);
  });

  it("restringe ingredientes e retorna cotação atual ao proprietário", async () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await bindings.DB.prepare(
      "INSERT INTO ingredients (ingredient_id, name, base_unit, pack_quantity, created_at, updated_at) VALUES (?, ?, 'g', '1000', ?, ?)",
    )
      .bind(id, `Ingrediente ${id}`, now, now)
      .run();
    await bindings.DB.prepare(
      "INSERT INTO ingredient_quotes (quote_id, ingredient_id, pack_price_cents, pack_quantity, base_unit, status, is_current, created_at) VALUES (?, ?, 1234, '1000', 'g', 'Confirmado', 1, ?)",
    )
      .bind(crypto.randomUUID(), id, now)
      .run();
    const url = "https://api.example.test/api/erp/ingredients";
    expect((await app.request(url, {}, bindings)).status).toBe(401);
    const response = await app.request(
      url,
      { headers: { cookie: await authenticatedCookie() } },
      bindings,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      data: Array<{ ingredient_id: string; pack_price_cents: number }>;
    }>();
    expect(body.data.find((item) => item.ingredient_id === id)).toMatchObject({
      pack_price_cents: 1234,
    });
  });

  it("retorna pagamentos corrigidos e taxas atuais no histórico", async () => {
    const sale = await makeOfflineOperation();
    if (sale.operationType !== "sale.create") throw new Error("tipo inválido");
    const salePayload = sale.payload as SaleCreatePayload;
    const date = salePayload.occurredOn;
    const saleId = salePayload.saleId;
    const stub = bindings.SALE_COORDINATOR.get(
      bindings.SALE_COORDINATOR.idFromName(`pdv-device:${sale.deviceId}`),
    );
    const send = (body: OperationEnvelope) =>
      stub.fetch(
        new Request("https://coordinator.local/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-actor-user-id": testActorId,
          },
          body: JSON.stringify(body),
        }),
      );
    expect((await send(sale)).status).toBe(201);
    const adjustment: OperationEnvelope = {
      ...sale,
      operationId: crypto.randomUUID(),
      operationType: "sale.adjust_payments",
      payloadHash: "0".repeat(64),
      payload: {
        saleId: sale.payload.saleId,
        basePaymentVersion: 1,
        reason: "Correção",
        payments: [
          {
            method: "Crédito",
            methodLabel: null,
            amountCents: 2500,
            feeRate: "0.0334",
            feeCents: 84,
            partNumber: 1,
            position: 0,
          },
        ],
      },
    };
    adjustment.payloadHash = await operationPayloadHash(adjustment);
    const adjustmentResponse = await send(adjustment);
    expect(adjustmentResponse.status, await adjustmentResponse.text()).toBe(
      201,
    );
    const response = await app.request(
      `https://api.example.test/api/pdv/sales?from=${date}&to=${date}`,
      { headers: { cookie: await authenticatedCookie() } },
      bindings,
    );
    expect(response.status).toBe(200);
    const data = await response.json<{
      sales: Array<{
        sale_id: string;
        fee_cents: number;
        net_cents: number;
        payments: Array<{ method: string }>;
      }>;
    }>();
    const result = data.sales.find((row) => row.sale_id === saleId);
    expect(result).toMatchObject({
      fee_cents: 84,
      net_cents: 2416,
      payments: [{ method: "Crédito" }],
    });
  });

  it("recusa reuso de chave com payload diferente", async () => {
    const operation = await makeOfflineOperation();
    const stub = bindings.SALE_COORDINATOR.get(
      bindings.SALE_COORDINATOR.idFromName(`pdv-device:${operation.deviceId}`),
    );
    const makeRequest = (body: unknown) =>
      new Request("https://coordinator.local/operations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-user-id": testActorId,
        },
        body: JSON.stringify(body),
      });
    expect((await stub.fetch(makeRequest(operation))).status).toBe(201);
    const changed = structuredClone(operation);
    if (changed.operationType !== "sale.create")
      throw new Error("type mismatch");
    (changed.payload as SaleCreatePayload).notes = "Payload divergente";
    changed.payloadHash = await operationPayloadHash(changed);
    expect((await stub.fetch(makeRequest(changed))).status).toBe(409);
  });

  it("bloqueia hash idêntico antes de 15 segundos e aceita no limite exato", async () => {
    const first = await makeOfflineOperation();
    first.occurredAt = "2026-11-01T15:00:00.000Z";
    if (first.operationType !== "sale.create") throw new Error("type mismatch");
    (first.payload as SaleCreatePayload).occurredOn = "2026-11-01";
    first.payloadHash = await operationPayloadHash(first);
    const stub = bindings.SALE_COORDINATOR.get(
      bindings.SALE_COORDINATOR.idFromName(`pdv-device:${first.deviceId}`),
    );
    const send = (operation: OperationEnvelope) =>
      stub.fetch(
        new Request("https://coordinator.local/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-actor-user-id": testActorId,
          },
          body: JSON.stringify(operation),
        }),
      );

    expect((await send(first)).status).toBe(201);
    const duplicate = structuredClone(first);
    duplicate.operationId = crypto.randomUUID();
    duplicate.occurredAt = "2026-11-01T15:00:14.999Z";
    if (duplicate.operationType !== "sale.create")
      throw new Error("type mismatch");
    duplicate.payload.saleId = `pdv-sale:${duplicate.operationId}`;
    duplicate.payloadHash = await operationPayloadHash(duplicate);
    expect((await send(duplicate)).status).toBe(409);

    const boundary = structuredClone(first);
    boundary.operationId = crypto.randomUUID();
    boundary.occurredAt = "2026-11-01T15:00:15.000Z";
    if (boundary.operationType !== "sale.create")
      throw new Error("type mismatch");
    boundary.payload.saleId = `pdv-sale:${boundary.operationId}`;
    boundary.payloadHash = await operationPayloadHash(boundary);
    expect((await send(boundary)).status).toBe(201);
  });

  it("grava e lê objetos do R2 pelo binding privado", async () => {
    const key = `backups/d1/test-${crypto.randomUUID()}.sql`;
    await bindings.PRIVATE_FILES.put(key, "SELECT 1;", {
      httpMetadata: { contentType: "application/sql" },
    });
    const object = await bindings.PRIVATE_FILES.get(key);
    expect(await object?.text()).toBe("SELECT 1;");
  });

  it("só entrega um backup pela rota autenticada", async () => {
    const key = `backups/d1/test-${crypto.randomUUID()}.sql`;
    const content = new TextEncoder().encode("SELECT 1;").buffer;
    await bindings.PRIVATE_FILES.put(key, content, {
      httpMetadata: { contentType: "application/sql" },
    });
    const digest = await crypto.subtle.digest("SHA-256", content);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await bindings.PRIVATE_FILES.put(
      key.replace(/\.sql$/, ".json"),
      JSON.stringify({
        contract: "sabores-da-canastra/d1-backup",
        contract_version: 1,
        database_id: "test",
        bookmark: "test",
        created_at: new Date().toISOString(),
        sql_key: key,
        size_bytes: content.byteLength,
        sha256,
        restore: "teste",
      }),
    );
    const url = `https://api.example.test/api/backups/file/${key}`;
    const appBindings = bindings;
    const cookie = await authenticatedCookie();
    const unauthorized = await app.request(url, {}, appBindings);
    expect(unauthorized.status).toBe(401);
    const authorized = await app.request(
      url,
      { headers: { cookie } },
      appBindings,
    );
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("cache-control")).toBe("private, no-store");
    expect(new TextDecoder().decode(await authorized.arrayBuffer())).toBe(
      "SELECT 1;",
    );
    await bindings.PRIVATE_FILES.put(key, "tampered");
    const tampered = await app.request(
      url,
      { headers: { cookie } },
      appBindings,
    );
    expect(tampered.status).toBe(409);
  });

  it("continua consultando D1 quando KV falha", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { listProducts } = await import("../src/catalog-cache");
    const all = vi.fn(async () => ({
      results: [{ product_id: "p1", name: "Produto" }],
    }));
    const db = { prepare: vi.fn(() => ({ all })) } as unknown as D1Database;
    const cache = {
      get: vi.fn(async () => {
        throw new Error("KV indisponível");
      }),
      put: vi.fn(async () => {
        throw new Error("KV indisponível");
      }),
    } as unknown as KVNamespace;
    const response = await listProducts(db, cache);
    expect(response).toEqual({
      data: [{ product_id: "p1", name: "Produto" }],
      source: "d1",
    });
    expect(db.prepare).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("ignora valores de cache que não sejam arrays", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { listProducts } = await import("../src/catalog-cache");
    const all = vi.fn(async () => ({ results: [{ product_id: "p1" }] }));
    const db = { prepare: vi.fn(() => ({ all })) } as unknown as D1Database;
    const cache = {
      get: vi.fn(async () => ({ invalid: true })),
      put: vi.fn(async () => {}),
    } as unknown as KVNamespace;
    const response = await listProducts(db, cache);
    expect(response).toEqual({ data: [{ product_id: "p1" }], source: "d1" });
    expect(db.prepare).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("limita caminhos de backup e calcula retenção pela idade", () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    expect(backupPrefix("bookmark:with/slashes", "workflow-123")).toBe(
      "backups/d1/bookmark_with_slashes-workflow-123",
    );
    expect(backupExpired("2026-09-30T00:00:00.000Z", now, 30)).toBe(true);
    expect(backupExpired("2026-10-31T00:00:00.000Z", now, 30)).toBe(false);
    expect(backupRetentionDays(undefined)).toBe(90);
    expect(backupRetentionDays("30")).toBe(30);
    expect(() => backupRetentionDays("6")).toThrow(
      "BACKUP_RETENTION_DAYS precisa estar entre 7 e 3650.",
    );
    expect(() => backupRetentionDays("3651")).toThrow(
      "BACKUP_RETENTION_DAYS precisa estar entre 7 e 3650.",
    );
  });

  it("aceita exportação D1 já concluída sem bookmark", () => {
    expect(
      initialExportState({
        success: true,
        result: {
          status: "complete",
          result: { signed_url: "https://example.test/export.sql" },
        },
      }),
    ).toEqual({
      bookmark: null,
      signedUrl: "https://example.test/export.sql",
    });
    expect(() =>
      initialExportState({
        result: { status: "error", error: "Falha" },
      }),
    ).toThrow("Falha");
  });

  it("faz escrita idempotente de backup no R2 e recusa colisão", async () => {
    const key = `backups/d1/immutable-${crypto.randomUUID()}.sql`;
    await putImmutableBackupObject(
      bindings.PRIVATE_FILES,
      key,
      "SELECT 1;",
      "application/sql",
    );
    await putImmutableBackupObject(
      bindings.PRIVATE_FILES,
      key,
      "SELECT 1;",
      "application/sql",
    );
    await expect(
      putImmutableBackupObject(
        bindings.PRIVATE_FILES,
        key,
        "SELECT 2;",
        "application/sql",
      ),
    ).rejects.toThrow("Backup key already contains different content");
  });

  it("valida e grava SQL grande em fluxo sem buffer completo", async () => {
    const key = `backups/d1/stream-${crypto.randomUUID()}.sql`;
    const makeStream = () =>
      new Blob(["SELECT ", "1;"]).stream() as ReadableStream<Uint8Array>;
    const expected = await hashStream(makeStream());
    await putImmutableBackupStream(
      bindings.PRIVATE_FILES,
      key,
      makeStream(),
      "application/sql",
      expected,
    );
    const object = await bindings.PRIVATE_FILES.get(key);
    expect(await object?.text()).toBe("SELECT 1;");
    expect(object?.customMetadata?.sha256).toBe(expected.sha256);
  });
});
