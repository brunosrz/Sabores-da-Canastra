// @vitest-environment-options {"url":"https://erp-preview.brunosrz.com"}
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Preferences } from "../src/preferences/Preferences";
import { readSharedPreference, writeSharedPreference } from "@sabores/i18n";
import { setLocale } from "@sabores/i18n/runtime";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  document.cookie = "sabores_theme=; Path=/; Domain=brunosrz.com; Max-Age=0";
  document.cookie = "sabores_locale=; Path=/; Domain=brunosrz.com; Max-Age=0";
  setLocale("pt-BR", { reload: false });
  localStorage.clear();
});

it("configura tema em Ajustes e compartilha cookie entre subdomínios, sem persistir dados de usuário", async () => {
  const setter = vi.spyOn(document, "cookie", "set");
  render(<Preferences />);
  fireEvent.change(screen.getByLabelText("Tema"), {
    target: { value: "dark" },
  });
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("dark"),
  );
  expect(setter).toHaveBeenCalledWith(
    expect.stringContaining("Domain=brunosrz.com"),
  );
  expect(setter).toHaveBeenCalledWith(
    expect.stringContaining("SameSite=Lax; Domain=brunosrz.com; Secure"),
  );
  expect(readSharedPreference("sabores_theme")).toBe("dark");
  expect(screen.getByLabelText("Idioma")).toHaveValue("pt-BR");
});

it("prioriza preferência compartilhada e aplica alteração recebida do outro app ao recuperar foco", async () => {
  localStorage.setItem("theme", "light");
  writeSharedPreference("sabores_theme", "dark");
  render(<Preferences />);
  expect(screen.getByLabelText("Tema")).toHaveValue("dark");
  writeSharedPreference("sabores_theme", "light");
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(screen.getByLabelText("Tema")).toHaveValue("light"),
  );
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("ignora cookies malformados", () => {
  document.cookie = "sabores_locale=%E0%A4%A; Path=/; Domain=brunosrz.com";
  expect(readSharedPreference("sabores_locale")).toBeNull();
  document.cookie = "sabores_locale=; Path=/; Domain=brunosrz.com; Max-Age=0";
});

it("apresenta as configurações em inglês e mantém os valores técnicos dos seletores", () => {
  writeSharedPreference("sabores_locale", "en");
  setLocale("en", { reload: false });
  render(<Preferences />);
  expect(screen.getByLabelText("Language")).toHaveValue("en");
  expect(screen.getByRole("option", { name: "Dark" })).toHaveValue("dark");
  expect(
    screen.getByText(
      "Language and theme are shared between ERP and PDV in this browser.",
    ),
  ).toBeInTheDocument();
});
