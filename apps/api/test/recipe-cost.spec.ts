import { describe, expect, it } from "vitest";
import { calculateRecipeCost, type RecipeCostLine } from "../src/recipe-cost";

const line: RecipeCostLine = {
  ingredient_name: "Farinha",
  quantity: "1",
  unit: "g",
  base_unit: "g",
  quote_unit: "g",
  pack_quantity: "3",
  pack_price_cents: 1,
};

describe("custeio de receitas", () => {
  it("soma valores exatos antes de arredondar lote e unidade", () => {
    const result = calculateRecipeCost([line, line], 2);
    expect(result.lines.map((item) => item.cost_cents)).toEqual([0, 0]);
    expect(result.batch_cost_cents).toBe(1);
    expect(result.unit_cost_cents).toBe(0);
  });
  it("mantém custos pendentes quando falta cotação ou unidade diverge", () => {
    const result = calculateRecipeCost(
      [line, { ...line, ingredient_name: "Leite", quote_unit: "ml" }],
      1,
    );
    expect(result.pending_ingredients).toEqual(["Leite"]);
    expect(result.batch_cost_cents).toBeNull();
    expect(result.unit_cost_cents).toBeNull();
    expect(calculateRecipeCost([], 1).batch_cost_cents).toBeNull();
  });
});
