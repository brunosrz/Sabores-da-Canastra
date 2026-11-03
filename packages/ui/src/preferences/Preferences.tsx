import { useEffect } from "react";
import {
  changeLocale,
  getLocale,
  readSharedPreference,
  t,
  type Locale,
} from "@sabores/i18n";
import { useTheme, type Theme } from "../theme/theme";

export function useLocaleSync() {
  useEffect(() => {
    const rendered = getLocale();
    const sync = () => {
      const shared = readSharedPreference("sabores_locale");
      if (
        document.visibilityState !== "hidden" &&
        (shared === "en" || shared === "pt-BR") &&
        shared !== rendered
      )
        window.location.reload();
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    const timer = window.setInterval(sync, 2000);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      window.clearInterval(timer);
    };
  }, []);
}
export function Preferences() {
  const { theme, setTheme } = useTheme();
  return (
    <section className="ui-preferences">
      <label>
        {t("Idioma")}
        <select
          className="ui-select"
          value={getLocale()}
          onChange={(event) => changeLocale(event.target.value as Locale)}
        >
          <option value="pt-BR">Português</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        {t("Tema")}
        <select
          className="ui-select"
          value={theme}
          onChange={(event) => setTheme(event.target.value as Theme)}
        >
          <option value="light">{t("Claro")}</option>
          <option value="dark">{t("Escuro")}</option>
          <option value="auto">{t("Sistema")}</option>
        </select>
      </label>
      <p>
        {t("Idioma e tema são compartilhados entre ERP e PDV neste navegador.")}
      </p>
    </section>
  );
}
