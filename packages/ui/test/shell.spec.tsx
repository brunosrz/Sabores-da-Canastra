import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AppShell } from "../src/shell/AppShell";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: () => "/",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("mantém a lateral aberta ao sair com o mouse ou navegar; recolhe somente pelo botão ou conteúdo", () => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query === "(min-width: 1024px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
  render(
    <AppShell
      appName="PDV"
      account={<button>Conta</button>}
      navItems={[{ to: "/", label: "Venda", icon: "+" }]}
    >
      <input aria-label="Buscar produto" />
    </AppShell>,
  );
  const nav = screen.getByRole("navigation");
  fireEvent.mouseEnter(nav);
  expect(nav).toHaveAttribute("data-expanded", "true");
  fireEvent.mouseLeave(nav);
  fireEvent.blur(nav);
  fireEvent.click(screen.getByRole("link", { name: "Venda" }));
  expect(nav).toHaveAttribute("data-expanded", "true");
  fireEvent.click(screen.getByRole("button", { name: "Recolher navegação" }));
  expect(nav).toHaveAttribute("data-expanded", "false");
  fireEvent.mouseEnter(nav);
  fireEvent.pointerDown(screen.getByRole("textbox"));
  expect(nav).toHaveAttribute("data-expanded", "false");
  fireEvent.mouseEnter(nav);
  fireEvent.focus(screen.getByRole("textbox"));
  expect(nav).toHaveAttribute("data-expanded", "false");
  const header = screen.getByRole("banner");
  expect(header.querySelector("select")).toBeNull();
  expect(header.querySelector(".ui-theme-toggle")).toBeNull();
});
