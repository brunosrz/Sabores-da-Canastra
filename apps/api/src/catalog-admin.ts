import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { hasTrustedOrigin, type AuthBindings, type AuthUser } from "./auth";
import { invalidateCatalogCache } from "./catalog-cache";

type AdminEnv = {
  Bindings: AuthBindings & { CATALOG_CACHE: KVNamespace };
  Variables: { authUser: AuthUser };
};
const admin = new Hono<AdminEnv>();
admin.use("*", async (c, next) => {
  if (c.get("authUser")?.role !== "owner")
    return c.json({ error: "Acesso negado." }, 403);
  c.header("cache-control", "private, no-store");
  if (
    !["GET", "HEAD"].includes(c.req.method) &&
    !hasTrustedOrigin(c.req.raw, c.env)
  )
    return c.json({ error: "Origem não autorizada." }, 403);
  await next();
});
admin.use(
  "*",
  bodyLimit({
    maxSize: 131072,
    onError: (c) => c.json({ error: "Corpo excede 128 KiB." }, 413),
  }),
);
admin.onError((error, c) => {
  if (error instanceof SyntaxError)
    return c.json({ error: "JSON inválido." }, 400);
  if (String(error).includes("RECIPE_UNIT_MISMATCH"))
    return c.json({ error: "Unidade incompatível com o ingrediente." }, 422);
  if (String(error).includes("UNIQUE constraint"))
    return c.json({ error: "Nome ou código já cadastrado." }, 409);
  if (String(error).includes("FOREIGN KEY constraint"))
    return c.json(
      {
        error:
          "Cadastro utilizado em receita, compra ou planejamento; remova os vínculos antes de excluir.",
      },
      409,
    );
  console.error("Falha no cadastro administrativo.", error);
  return c.json({ error: "Cadastro indisponível." }, 503);
});
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const nullableText = (v: unknown, max: number) =>
  v === null || (typeof v === "string" && v.length <= max);
const money = (v: unknown) =>
  v === null || (Number.isSafeInteger(v) && Number(v) >= 0);
function productValid(b: Record<string, unknown>) {
  return (
    text(b.name, 200) &&
    text(b.category_id, 120) &&
    text(b.unit, 20) &&
    money(b.sale_price_cents) &&
    money(b.unit_cost_cents) &&
    nullableText(b.barcode, 120) &&
    nullableText(b.auxiliary_code, 120) &&
    nullableText(b.notes, 2000) &&
    (b.active === 0 || b.active === 1)
  );
}
async function object(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const b: unknown = await request.json();
  return b !== null && typeof b === "object" && !Array.isArray(b)
    ? (b as Record<string, unknown>)
    : null;
}
admin.get("/categories", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM categories ORDER BY name COLLATE NOCASE",
  ).all();
  return c.json({ data: result.results });
});
admin.post("/categories", async (c) => {
  const b = await object(c.req.raw);
  if (!b || !text(b.name, 200))
    return c.json({ error: "Nome inválido.", field: "name" }, 422);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO categories (category_id, name, created_at) VALUES (?, ?, ?)",
  )
    .bind(id, String(b.name).trim(), new Date().toISOString())
    .run();
  await invalidateCatalogCache(c.env.CATALOG_CACHE);
  return c.json({ category_id: id }, 201);
});
admin.put("/categories/:id", async (c) => {
  const b = await object(c.req.raw);
  if (!b || !text(b.name, 200))
    return c.json({ error: "Nome inválido.", field: "name" }, 422);
  const result = await c.env.DB.prepare(
    "UPDATE categories SET name = ? WHERE category_id = ?",
  )
    .bind(String(b.name).trim(), c.req.param("id"))
    .run();
  if (!result.meta.changes)
    return c.json({ error: "Categoria não encontrada." }, 404);
  await invalidateCatalogCache(c.env.CATALOG_CACHE);
  return c.json({ status: "updated" });
});
admin.get("/products", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT p.*, c.name AS category FROM products p JOIN categories c ON c.category_id = p.category_id ORDER BY p.name COLLATE NOCASE",
  ).all();
  return c.json({ data: result.results });
});
async function saveProduct(
  c: import("hono").Context<AdminEnv>,
  create: boolean,
) {
  const b = await object(c.req.raw);
  if (!b || !productValid(b))
    return c.json(
      {
        error:
          "Preencha todos os campos do produto; preços e notas podem ser nulos.",
      },
      422,
    );
  const category = await c.env.DB.prepare(
    "SELECT category_id FROM categories WHERE category_id = ?",
  )
    .bind(b.category_id)
    .first();
  if (!category)
    return c.json(
      { error: "Categoria inexistente.", field: "category_id" },
      422,
    );
  const id = create ? crypto.randomUUID() : c.req.param("id");
  const now = new Date().toISOString();
  const values = [
    String(b.name).trim(),
    b.category_id,
    b.unit,
    b.barcode || null,
    b.auxiliary_code || null,
    b.sale_price_cents,
    b.unit_cost_cents,
    b.active,
    b.notes,
    now,
  ];
  const result = create
    ? await c.env.DB.prepare(
        "INSERT INTO products (name, category_id, unit, barcode, auxiliary_code, sale_price_cents, unit_cost_cents, active, notes, updated_at, product_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(...values, id, now)
        .run()
    : await c.env.DB.prepare(
        "UPDATE products SET name = ?, category_id = ?, unit = ?, barcode = ?, auxiliary_code = ?, sale_price_cents = ?, unit_cost_cents = ?, active = ?, notes = ?, updated_at = ? WHERE product_id = ?",
      )
        .bind(...values, id)
        .run();
  if (!result.meta.changes)
    return c.json({ error: "Produto não encontrado." }, 404);
  await invalidateCatalogCache(c.env.CATALOG_CACHE);
  return c.json({ product_id: id }, create ? 201 : 200);
}
admin.post("/products", (c) => saveProduct(c, true));
admin.put("/products/:id", (c) => saveProduct(c, false));

const units = new Set(["g", "ml", "un"]);
const quoteStatuses = new Set([
  "Confirmado",
  "Estimado",
  "Pendente",
  "Desatualizado",
]);
function positiveDecimal(v: unknown) {
  return (
    typeof v === "string" &&
    v.length <= 30 &&
    /^\d+(?:\.\d{1,9})?$/.test(v) &&
    /[1-9]/.test(v)
  );
}
function validDate(v: unknown) {
  return (
    v === null ||
    (typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v)
  );
}
admin.get("/ingredients", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT i.*, q.pack_price_cents, q.status, q.quoted_on, q.source
    FROM ingredients i LEFT JOIN ingredient_quotes q ON q.ingredient_id = i.ingredient_id AND q.is_current = 1
    ORDER BY i.name COLLATE NOCASE`,
  ).all();
  return c.json({ data: result.results });
});
async function saveIngredient(
  c: import("hono").Context<AdminEnv>,
  create: boolean,
) {
  const b = await object(c.req.raw);
  if (
    !b ||
    !text(b.name, 200) ||
    !units.has(String(b.base_unit)) ||
    !positiveDecimal(b.pack_quantity) ||
    !money(b.pack_price_cents) ||
    !nullableText(b.supplier, 200) ||
    !nullableText(b.notes, 2000) ||
    !nullableText(b.source, 500) ||
    !validDate(b.quoted_on) ||
    !quoteStatuses.has(String(b.status)) ||
    (b.status === "Confirmado" && b.pack_price_cents === null)
  ) {
    return c.json(
      {
        error:
          "Informe nome, unidade, quantidade positiva, preço em centavos ou nulo, status e data válida. Cotações confirmadas exigem preço.",
      },
      422,
    );
  }
  const id = create ? crypto.randomUUID() : c.req.param("id");
  const now = new Date().toISOString();
  if (!create) {
    const current = await c.env.DB.prepare(
      "SELECT ingredient_id FROM ingredients WHERE ingredient_id = ?",
    )
      .bind(id)
      .first();
    if (!current) return c.json({ error: "Ingrediente não encontrado." }, 404);
  }
  // The conditional update also enforces unit compatibility inside the transaction.
  const ingredient = create
    ? c.env.DB.prepare(
        "INSERT INTO ingredients (ingredient_id, name, base_unit, pack_quantity, supplier, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        id,
        String(b.name).trim(),
        b.base_unit,
        b.pack_quantity,
        b.supplier,
        b.notes,
        now,
        now,
      )
    : c.env.DB.prepare(
        `UPDATE ingredients SET name = ?, base_unit = ?, pack_quantity = ?, supplier = ?, notes = ?, updated_at = ?
        WHERE ingredient_id = ? AND NOT EXISTS (SELECT 1 FROM recipe_lines WHERE ingredient_id = ? AND unit != ?)`,
      ).bind(
        String(b.name).trim(),
        b.base_unit,
        b.pack_quantity,
        b.supplier,
        b.notes,
        now,
        id,
        id,
        b.base_unit,
      );
  // All quote writes depend on the preceding update, preventing a partial change.
  const result = await c.env.DB.batch([
    ingredient,
    c.env.DB.prepare(
      "UPDATE ingredient_quotes SET is_current = 0 WHERE ingredient_id = ? AND is_current = 1 AND changes() > 0",
    ).bind(id),
    c.env.DB.prepare(
      `INSERT INTO ingredient_quotes (quote_id, ingredient_id, pack_price_cents, pack_quantity, base_unit, supplier, quoted_on, status, source, notes, is_current, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM ingredients WHERE ingredient_id = ? AND updated_at = ? AND base_unit = ?)
      AND NOT EXISTS (SELECT 1 FROM recipe_lines WHERE ingredient_id = ? AND unit != ?)`,
    ).bind(
      crypto.randomUUID(),
      id,
      b.pack_price_cents,
      b.pack_quantity,
      b.base_unit,
      b.supplier,
      b.quoted_on,
      b.status,
      b.source,
      b.notes,
      now,
      id,
      now,
      b.base_unit,
      id,
      b.base_unit,
    ),
  ]);
  if (!result[0].meta.changes)
    return c.json(
      {
        error:
          "A unidade não pode divergir das receitas que utilizam este ingrediente.",
      },
      409,
    );
  await invalidateCatalogCache(c.env.CATALOG_CACHE);
  return c.json({ ingredient_id: id }, create ? 201 : 200);
}
admin.post("/ingredients", (c) => saveIngredient(c, true));
admin.put("/ingredients/:id", (c) => saveIngredient(c, false));
admin.delete("/ingredients/:id", async (c) => {
  const id = c.req.param("id");
  // Foreign keys roll back the whole batch when a recipe or purchase refers to it.
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM ingredient_quotes WHERE ingredient_id = ?",
    ).bind(id),
    c.env.DB.prepare("DELETE FROM ingredients WHERE ingredient_id = ?").bind(
      id,
    ),
  ]);
  if (!result[1].meta.changes)
    return c.json({ error: "Ingrediente não encontrado." }, 404);
  await invalidateCatalogCache(c.env.CATALOG_CACHE);
  return c.json({ status: "deleted" });
});

type RecipeLineInput = {
  ingredient_id: string;
  quantity: string;
  unit: string;
  stage: string | null;
};
function recipeLineValid(value: unknown): value is RecipeLineInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  return (
    text(b.ingredient_id, 120) &&
    typeof b.quantity === "string" &&
    b.quantity.length <= 30 &&
    /^\d+(?:\.\d{1,9})?$/.test(b.quantity) &&
    units.has(String(b.unit)) &&
    nullableText(b.stage, 200)
  );
}
async function saveRecipe(
  c: import("hono").Context<AdminEnv>,
  create: boolean,
) {
  const b = await object(c.req.raw);
  if (
    !b ||
    !text(b.product_name, 200) ||
    !nullableText(b.product_id, 120) ||
    (b.product_id !== null && !text(b.product_id, 120)) ||
    !text(b.version, 80) ||
    !Number.isSafeInteger(b.yield_units) ||
    Number(b.yield_units) <= 0 ||
    !nullableText(b.source, 500) ||
    !nullableText(b.instructions, 10000) ||
    !Array.isArray(b.lines) ||
    b.lines.length < 1 ||
    b.lines.length > 80 ||
    !b.lines.every(recipeLineValid)
  ) {
    return c.json(
      {
        error:
          "Receita exige nome, versão, rendimento inteiro positivo e de 1 a 80 ingredientes com quantidades não negativas.",
      },
      422,
    );
  }
  const lines = b.lines as RecipeLineInput[];
  const id = create ? crypto.randomUUID() : c.req.param("id");
  if (
    !create &&
    !(await c.env.DB.prepare(
      "SELECT recipe_id FROM recipes WHERE recipe_id = ?",
    )
      .bind(id)
      .first())
  )
    return c.json({ error: "Receita não encontrada." }, 404);
  const product =
    b.product_id === null
      ? null
      : await c.env.DB.prepare("SELECT name FROM products WHERE product_id = ?")
          .bind(b.product_id)
          .first<{ name: string }>();
  if (b.product_id !== null && !product)
    return c.json({ error: "Produto inexistente.", field: "product_id" }, 422);
  const uniqueIds = [...new Set(lines.map((line) => line.ingredient_id))];
  const ingredients = await c.env.DB.prepare(
    `SELECT ingredient_id, base_unit FROM ingredients WHERE ingredient_id IN (${uniqueIds.map(() => "?").join(",")})`,
  )
    .bind(...uniqueIds)
    .all<{ ingredient_id: string; base_unit: string }>();
  const unitById = new Map(
    ingredients.results.map((i) => [i.ingredient_id, i.base_unit]),
  );
  if (lines.some((line) => unitById.get(line.ingredient_id) !== line.unit))
    return c.json(
      {
        error: "Ingrediente inexistente ou unidade incompatível.",
        field: "lines",
      },
      422,
    );
  const now = new Date().toISOString();
  const header = create
    ? c.env.DB.prepare(
        "INSERT INTO recipes (product_name, product_id, version, yield_units, source, instructions, updated_at, recipe_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        product?.name ?? String(b.product_name).trim(),
        b.product_id,
        b.version,
        b.yield_units,
        b.source,
        b.instructions,
        now,
        id,
        now,
      )
    : c.env.DB.prepare(
        "UPDATE recipes SET product_name = ?, product_id = ?, version = ?, yield_units = ?, source = ?, instructions = ?, updated_at = ? WHERE recipe_id = ?",
      ).bind(
        product?.name ?? String(b.product_name).trim(),
        b.product_id,
        b.version,
        b.yield_units,
        b.source,
        b.instructions,
        now,
        id,
      );
  await c.env.DB.batch([
    header,
    c.env.DB.prepare("DELETE FROM recipe_lines WHERE recipe_id = ?").bind(id),
    ...lines.map((line) =>
      c.env.DB.prepare(
        "INSERT INTO recipe_lines (line_id, recipe_id, ingredient_id, quantity, unit, stage) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        id,
        line.ingredient_id,
        line.quantity,
        line.unit,
        line.stage,
      ),
    ),
  ]);
  await invalidateCatalogCache(c.env.CATALOG_CACHE);
  return c.json({ recipe_id: id }, create ? 201 : 200);
}
admin.post("/recipes", (c) => saveRecipe(c, true));
admin.put("/recipes/:id", (c) => saveRecipe(c, false));
admin.delete("/recipes/:id", async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM recipe_lines WHERE recipe_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM recipes WHERE recipe_id = ?").bind(id),
  ]);
  if (!result[1].meta.changes)
    return c.json({ error: "Receita não encontrada." }, 404);
  await invalidateCatalogCache(c.env.CATALOG_CACHE);
  return c.json({ status: "deleted" });
});
export default admin;
