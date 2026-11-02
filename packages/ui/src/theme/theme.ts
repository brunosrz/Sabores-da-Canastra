import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "auto";

export const themeInitScript = `(function(){try{var s=localStorage.getItem('theme');var m=s==='light'||s==='dark'||s==='auto'?s:'auto';var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=m==='auto'?(d?'dark':'light'):m;var e=document.documentElement;e.dataset.theme=r;e.style.colorScheme=r;var c=document.querySelector('meta[name="theme-color"]');if(c)c.content=r==='dark'?'#181818':'#fff9f1'}catch(_){}})();`;

function resolvedTheme(
  theme: Theme,
  darkPreference: boolean,
): "light" | "dark" {
  return theme === "auto" ? (darkPreference ? "dark" : "light") : theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("auto");

  const apply = useCallback((mode: Theme) => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved = resolvedTheme(mode, dark);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#181818" : "#fff9f1");
  }, []);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("theme");
    } catch {
      // Falha de acesso ao storage mantém o tema no padrão do sistema.
    }
    const initial: Theme =
      stored === "light" || stored === "dark" || stored === "auto"
        ? stored
        : "auto";
    setThemeState(initial);
    apply(initial);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onPreferenceChange = () => {
      if (initial === "auto") apply("auto");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "theme") return;
      const next: Theme =
        event.newValue === "light" ||
        event.newValue === "dark" ||
        event.newValue === "auto"
          ? event.newValue
          : "auto";
      setThemeState(next);
      apply(next);
    };
    media.addEventListener("change", onPreferenceChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onPreferenceChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [apply]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      apply(next);
      try {
        window.localStorage.setItem("theme", next);
      } catch {
        // Theme preference remains active for this page even when storage is unavailable.
      }
    },
    [apply],
  );

  return { theme, setTheme };
}
