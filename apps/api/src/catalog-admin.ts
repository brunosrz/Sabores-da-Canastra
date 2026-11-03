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
  if (String(error).includes("UNIQUE constraint"))
    return c.json({ error: "Nome ou código já cadastrado." }, 409);
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
export default admin;
