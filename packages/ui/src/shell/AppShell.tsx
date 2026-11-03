import { t } from "@sabores/i18n";
import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTheme } from "../theme/theme";
import { useLocaleSync } from "../preferences/Preferences";
import { useVirtualKeyboard } from "./useVirtualKeyboard";

export type NavItem = { to: string; label: string; icon: ReactNode };

export function AppShell({
  appName,
  navItems,
  account,
  children,
}: {
  appName: string;
  navItems: NavItem[];
  account: ReactNode;
  children: ReactNode;
}) {
  useVirtualKeyboard();
  useTheme();
  useLocaleSync();
  const [expanded, setExpanded] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const updateInert = () => {
      if (navRef.current)
        navRef.current.inert = root.dataset.keyboard === "open";
    };
    const observer = new MutationObserver(updateInert);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-keyboard"],
    });
    updateInert();
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="ui-app-shell"
      style={{ "--nav-count": Math.min(navItems.length, 5) } as CSSProperties}
    >
      <header className="ui-app-header">
        <a className="ui-brand" href="#conteudo" aria-label={appName}>
          {appName}
        </a>
        <div className="ui-account">{account}</div>
      </header>
      <motion.nav
        ref={navRef}
        className="ui-bottom-nav"
        aria-label={t("Navegação principal")}
        initial={false}
        animate={{ width: expanded ? 240 : 76 }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
        onMouseEnter={() => {
          if (window.matchMedia("(min-width: 1024px)").matches)
            setExpanded(true);
        }}
        onFocusCapture={(event) => {
          if (!(event.target as HTMLElement).closest(".ui-sidebar-toggle"))
            setExpanded(true);
        }}
        data-expanded={expanded}
      >
        <button
          type="button"
          className="ui-sidebar-toggle"
          aria-label={
            expanded ? t("Recolher navegação") : t("Expandir navegação")
          }
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{expanded ? "‹" : "›"}</span>
          {expanded ? <span>{t("Recolher")}</span> : null}
        </button>
        {navItems.slice(0, 5).map((item) => (
          <Link
            className="ui-nav-link"
            key={item.to}
            to={item.to as never}
            aria-current={pathname === item.to ? "page" : undefined}
          >
            <span className="ui-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="ui-nav-label">{t(item.label)}</span>
          </Link>
        ))}
      </motion.nav>
      <main
        id="conteudo"
        className="ui-main"
        tabIndex={-1}
        onPointerDownCapture={() => setExpanded(false)}
        onFocusCapture={() => setExpanded(false)}
      >
        {children}
      </main>
    </div>
  );
}
