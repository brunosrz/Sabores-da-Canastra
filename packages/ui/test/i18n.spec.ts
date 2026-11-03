// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t, getLocale } from "@sabores/i18n";
import { paraglideMiddleware } from "@sabores/i18n/server";

describe("contrato das traduções Paraglide", () => {
  it("preserva nomes desconhecidos, inclusive propriedades herdadas de Object", () => {
    expect(t("__proto__")).toBe("__proto__");
    expect(t("constructor")).toBe("constructor");
    expect(t("toString")).toBe("toString");
  });
  it("tem as mesmas chaves e parâmetros nos dois idiomas e nenhum caractere de substituição", () => {
    const read = (locale: string): Record<string, string> =>
      JSON.parse(
        readFileSync(
          new URL(`../../i18n/messages/${locale}.json`, import.meta.url),
          "utf8",
        ),
      );
    const pt = read("pt-BR");
    const en = read("en");
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(pt).length).toBeGreaterThan(300);
    for (const key of Object.keys(pt)) {
      expect(en[key].trim()).not.toBe("");
      expect(pt[key] + en[key]).not.toContain("\uFFFD");
      expect(
        [...pt[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
      ).toEqual([...en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });

  it("isola o idioma por requisição concorrente e não traduz nomes cadastrados", async () => {
    const request = (locale: string) =>
      paraglideMiddleware(
        new Request("https://erp-preview.brunosrz.com/ajustes", {
          headers: { cookie: `sabores_locale=${locale}` },
        }),
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return Response.json({
            locale: getLocale(),
            label: t("Idioma"),
            sale: t("{p0} produtos cadastrados.", { p0: 67 }),
            product: t("Produto personalizado sem tradução"),
          });
        },
      );
    const [pt, en, invalid] = await Promise.all([
      request("pt-BR"),
      request("en"),
      request("xx"),
    ]);
    expect(await pt.json()).toMatchObject({ locale: "pt-BR", label: "Idioma" });
    expect(await en.json()).toEqual({
      locale: "en",
      label: "Language",
      sale: "67 registered products.",
      product: "Produto personalizado sem tradução",
    });
    expect(await invalid.json()).toMatchObject({
      locale: "pt-BR",
      label: "Idioma",
    });
  });
});
