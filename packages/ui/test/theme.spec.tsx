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
  it("aplica e persiste apenas a preferência de tema selecionada", async () => {
    render(<ThemeToggle />);
    const dark = screen.getByRole("radio", { name: "Escuro" });
    fireEvent.click(dark);

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "dark"),
    );
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.length).toBe(1);
    expect(dark).toHaveAttribute("aria-checked", "true");
    expect(dark).toHaveAttribute("tabindex", "0");
  });

  it("permite navegar as opções de tema pelo teclado", () => {
    render(<ThemeToggle />);
    const light = screen.getByRole("radio", { name: "Claro" });
    light.focus();
    fireEvent.keyDown(light, { key: "ArrowRight" });

    const dark = screen.getByRole("radio", { name: "Escuro" });
    expect(dark).toHaveFocus();
    expect(dark).toHaveAttribute("aria-checked", "true");
  });

  it("aplica mudanças de tema feitas em outra aba", async () => {
    render(<ThemeToggle />);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme", newValue: "light" }),
    );
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "light"),
    );
    expect(screen.getByRole("radio", { name: "Claro" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
