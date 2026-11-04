import { calculateRecipeCost, type RecipeCostLine } from "./recipe-cost";

export type CostProduct = {
  product_id: string;
  name: string;
  unit_cost_cents: number | null;
};
export type ResolvedProductCost = {
  unit_cost_cents: number | null;
  cost_source: "manual" | "recipe" | "pending";
  cost_recipe_id: string | null;
  cost_quality: string;
};
type Recipe = {
  recipe_id: string;
  product_id: string | null;
  product_name: string;
  version: string;
  yield_units: number;
  selected: number;
};

/** Resolve in bulk: no query per product or ingredient. Historical sales never call this reader. */
export async function resolveProductCosts(
  db: D1Database,
  products: CostProduct[],
): Promise<Map<string, ResolvedProductCost>> {
  const resolved = new Map<string, ResolvedProductCost>();
  if (!products.length) return resolved;
  const { results: recipes } = await db
    .prepare(
      `SELECT r.recipe_id, r.product_id, r.product_name, r.version, r.yield_units,
    CASE WHEN m.quantity > 0 AND m.selected_version = r.version THEN 1 ELSE 0 END AS selected
    FROM recipes r LEFT JOIN daily_mix m ON m.recipe_id = r.recipe_id
    WHERE r.product_id IN (SELECT value FROM json_each(?)) OR
      (r.product_id IS NULL AND r.product_name IN (SELECT value FROM json_each(?)))
    ORDER BY selected DESC, r.version, r.recipe_id`,
    )
    .bind(
      JSON.stringify(products.map((p) => p.product_id)),
      JSON.stringify(products.map((p) => p.name)),
    )
    .all<Recipe>();
  const grouped = new Map<string, RecipeCostLine[]>();
  if (recipes.length) {
    const { results: lines } = await db
      .prepare(
        `SELECT l.recipe_id, i.name AS ingredient_name, l.quantity, l.unit, i.base_unit,
      q.base_unit AS quote_unit, q.pack_quantity, q.pack_price_cents, q.status AS quote_status
      FROM recipe_lines l JOIN ingredients i ON i.ingredient_id = l.ingredient_id
      LEFT JOIN ingredient_quotes q ON q.ingredient_id = i.ingredient_id AND q.is_current = 1
      WHERE l.recipe_id IN (SELECT value FROM json_each(?)) ORDER BY l.recipe_id, l.line_id`,
      )
      .bind(JSON.stringify(recipes.map((r) => r.recipe_id)))
      .all<RecipeCostLine & { recipe_id: string }>();
    for (const line of lines) {
      const list = grouped.get(line.recipe_id) ?? [];
      list.push(line);
      grouped.set(line.recipe_id, list);
    }
  }
  const costs = new Map(
    recipes.map((r) => [
      r.recipe_id,
      calculateRecipeCost(grouped.get(r.recipe_id) ?? [], r.yield_units),
    ]),
  );
  for (const product of products) {
    if (product.unit_cost_cents !== null) {
      resolved.set(product.product_id, {
        unit_cost_cents: product.unit_cost_cents,
        cost_source: "manual",
        cost_recipe_id: null,
        cost_quality: "Confirmado",
      });
      continue;
    }
    const matching = recipes.filter(
      (r) =>
        r.product_id === product.product_id ||
        (r.product_id === null && r.product_name === product.name),
    );
    const recipe = matching.find(
      (r) => costs.get(r.recipe_id)!.unit_cost_cents !== null,
    );
    const cost = recipe ? costs.get(recipe.recipe_id)! : null;
    resolved.set(product.product_id, {
      unit_cost_cents: cost?.unit_cost_cents ?? null,
      cost_source: cost ? "recipe" : "pending",
      cost_recipe_id: recipe?.recipe_id ?? null,
      cost_quality: cost?.quality ?? "Pendente",
    });
  }
  return resolved;
}

export async function productsWithCosts<T extends CostProduct>(
  db: D1Database,
  products: T[],
) {
  const costs = await resolveProductCosts(db, products);
  return products.map((p) => ({
    ...p,
    manual_unit_cost_cents: p.unit_cost_cents,
    ...costs.get(p.product_id)!,
  }));
}
