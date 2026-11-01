const CATALOG_KEY = "catalog:v1:products:active";
const CACHE_TTL_SECONDS = 60;

export async function invalidateCatalogCache(
  cache: KVNamespace,
): Promise<void> {
  try {
    await cache.delete(CATALOG_KEY);
  } catch (error) {
    console.warn(
      "Falha ao invalidar cache do catálogo; D1 permanece autoritativo.",
      error,
    );
  }
}

export async function listProducts(db: D1Database, cache: KVNamespace) {
  try {
    const cached = await cache.get(CATALOG_KEY, "json");
    if (cached !== null) return { data: cached, source: "cache" as const };
  } catch (error) {
    console.warn("Cache KV indisponível; consultando D1.", error);
  }

  const { results } = await db
    .prepare(
      `SELECT p.product_id, p.barcode, p.auxiliary_code, p.name,
              c.name AS category, p.unit, p.sale_price_cents,
              p.active
       FROM products p JOIN categories c ON c.category_id = p.category_id
       WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE`,
    )
    .all();

  try {
    await cache.put(CATALOG_KEY, JSON.stringify(results), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.warn("Falha ao atualizar cache KV; resposta veio do D1.", error);
  }
  return { data: results, source: "d1" as const };
}
