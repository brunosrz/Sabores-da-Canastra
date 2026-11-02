import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { ThemeToggle } from "../theme/ThemeToggle";
import { useVirtualKeyboard } from "./useVirtualKeyboard";
import { SkipLink } from "../components/primitives";

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
      <SkipLink />
      <header className="ui-app-header">
        <a className="ui-brand" href="#conteudo" aria-label={appName}>
          {appName}
        </a>
        <div className="ui-account">
          {account}
          <ThemeToggle />
        </div>
      </header>
      <nav
        ref={navRef}
        className="ui-bottom-nav"
        aria-label="Navegação principal"
      >
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
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <main id="conteudo" className="ui-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
