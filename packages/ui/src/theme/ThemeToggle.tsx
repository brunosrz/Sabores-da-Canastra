import { t } from "@sabores/i18n";
import { useTheme } from "./theme";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  function toggleTheme() {
    const current =
      theme === "auto"
        ? document.documentElement.dataset.theme === "dark"
          ? "dark"
          : "light"
        : theme;
    setTheme(current === "dark" ? "light" : "dark");
  }
  return (
    <button
      aria-label={t("Alternar tema claro e escuro")}
      aria-pressed={theme === "dark"}
      className="ui-theme-toggle"
      onClick={toggleTheme}
      title={t("Alternar tema claro e escuro")}
      type="button"
    >
      <svg
        className="ui-theme-icon ui-theme-icon-sun"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </svg>
      <svg
        className="ui-theme-icon ui-theme-icon-moon"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M20.4 15.3A8.7 8.7 0 0 1 8.7 3.6 8.8 8.8 0 1 0 20.4 15.3Z" />
      </svg>
    </button>
  );
}
