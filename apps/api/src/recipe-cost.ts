export type RecipeCostLine = {
  ingredient_name: string;
  quantity: string;
  unit: string;
  base_unit: string;
  quote_unit: string | null;
  pack_quantity: string | null;
  pack_price_cents: number | null;
  quote_status?: string | null;
};

function decimal(value: string): [bigint, bigint] | null {
  if (value.length > 30 || !/^\d+(?:\.\d{1,9})?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return [
    BigInt(integer!) * denominator + BigInt(fraction || "0"),
    denominator,
  ];
}
function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
function round(n: bigint, d: bigint): number {
  const result = (2n * n + d) / (2n * d);
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("CUSTO_EXCESSIVO");
  return Number(result);
}

/** Soma as frações sem arredondar linhas antes de calcular o lote e a unidade. */
export function calculateRecipeCost(
  lines: RecipeCostLine[],
  yieldUnits: number,
) {
  if (!Number.isSafeInteger(yieldUnits) || yieldUnits <= 0)
    throw new Error("RENDIMENTO_INVALIDO");
  let numerator = 0n;
  let denominator = 1n;
  const pending: string[] = lines.length ? [] : ["Receita sem ingredientes"];
  let quality = "Confirmado";
  const details = lines.map((line) => {
    const quantity = decimal(line.quantity);
    const pack =
      line.pack_quantity === null ? null : decimal(line.pack_quantity);
    if (
      !quantity ||
      !pack ||
      pack[0] === 0n ||
      line.unit !== line.base_unit ||
      line.unit !== line.quote_unit ||
      line.pack_price_cents === null ||
      !Number.isSafeInteger(line.pack_price_cents) ||
      line.pack_price_cents < 0 ||
      line.quote_status === "Pendente" ||
      line.quote_status === null
    ) {
      pending.push(line.ingredient_name);
      return { ...line, cost_cents: null };
    }
    if (line.quote_status === "Desatualizado") quality = "Desatualizado";
    else if (line.quote_status === "Estimado" && quality === "Confirmado")
      quality = "Estimado";
    const n = quantity[0] * pack[1] * BigInt(line.pack_price_cents);
    const d = quantity[1] * pack[0];
    numerator = numerator * d + n * denominator;
    denominator *= d;
    const common = gcd(numerator, denominator);
    numerator /= common;
    denominator /= common;
    return { ...line, cost_cents: round(n, d) };
  });
  return {
    quality: pending.length ? "Pendente" : quality,
    batch_cost_cents: pending.length ? null : round(numerator, denominator),
    unit_cost_cents: pending.length
      ? null
      : round(numerator, denominator * BigInt(yieldUnits)),
    pending_ingredients: pending,
    lines: details,
  };
}
