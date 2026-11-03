import { catalog } from "./catalog";
import { getLocale, setLocale, type Locale } from "./paraglide/runtime.js";
import { writeSharedPreference } from "./preferences";

export { getLocale, type Locale } from "./paraglide/runtime.js";
export { readSharedPreference, writeSharedPreference } from "./preferences";

/** Translate presentation text. Never use this to construct API or ledger payloads. */
export function t(
  source: string | number | null | undefined,
  inputs: Record<string, unknown> = {},
): string {
  if (source == null) return "";
  return Object.hasOwn(catalog, source)
    ? catalog[source](inputs)
    : String(source);
}

export function formatLocale(): string {
  return getLocale() === "en" ? "en-US" : "pt-BR";
}

export function changeLocale(locale: Locale) {
  if (locale !== "en" && locale !== "pt-BR") return;
  writeSharedPreference("sabores_locale", locale);
  // A document navigation also refreshes route labels and request-scoped messages.
  setLocale(locale);
}
