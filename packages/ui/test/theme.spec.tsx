import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "../src";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("color-scheme");
});

describe("tema persistido no dispositivo", () => {
  it("alterna entre claro e escuro e sincroniza as instâncias da página", async () => {
    render(
      <>
        <ThemeToggle />
        <ThemeToggle />
      </>,
    );
    const toggles = screen.getAllByRole("button", {
      name: "Alternar tema claro e escuro",
    });
    fireEvent.click(toggles[0]!);
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "dark"),
    );
    expect(localStorage.getItem("theme")).toBe("dark");

    fireEvent.click(toggles[1]!);
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "light"),
    );
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("não substitui uma preferência manual quando muda o tema do sistema", async () => {
    localStorage.setItem("theme", "light");
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (media: string) => ({
        matches: false,
        media,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.add(listener),
        removeEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.delete(listener),
        dispatchEvent: () => false,
      }),
    });
    render(<ThemeToggle />);
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "light"),
    );
    for (const listener of listeners)
      listener({ matches: true } as MediaQueryListEvent);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("aplica mudanças de preferência recebidas de outra aba", async () => {
    render(<ThemeToggle />);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme", newValue: "dark" }),
    );
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "dark"),
    );
  });
});
