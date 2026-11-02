import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "../src/styles/tokens.css"),
  "utf8",
);

function token(selector: string, name: string) {
  const block = new RegExp(`${selector}\\s*\\{([^}]+)\\}`).exec(source)?.[1];
  const value =
    block && new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
  if (!value) throw new Error(`Token --${name} ausente em ${selector}`);
  return value;
}

function luminance(color: string) {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(first: string, second: string) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("contraste dos tokens de interface", () => {
  it("mantém texto e indicadores legíveis nos dois temas", () => {
    for (const [selector, surface] of [
      [":root", "surface-raised"],
      [':root\\[data-theme="dark"]', "surface-raised"],
    ]) {
      const background = token(selector, surface);
      for (const foreground of [
        "text",
        "text-muted",
        "price-text",
        "focus-ring",
        "danger",
        "success",
        "warning",
      ]) {
        const minimum = foreground === "focus-ring" ? 3 : 4.5;
        expect(
          contrast(token(selector, foreground), background),
          `${foreground} sobre ${background}`,
        ).toBeGreaterThanOrEqual(minimum);
      }
    }
  });

  it("garante contraste AA para as cores e rótulos de categoria", () => {
    const light = ":root";
    for (const category of [
      "pizzas",
      "lanches",
      "porcoes",
      "novidades",
      "promocao",
      "limitado",
      "salgados",
      "bebidas",
      "doces",
      "molhos",
      "outros",
    ]) {
      expect(
        contrast(
          token(light, `cat-${category}`),
          token(light, `on-cat-${category}`),
        ),
        `categoria ${category}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
