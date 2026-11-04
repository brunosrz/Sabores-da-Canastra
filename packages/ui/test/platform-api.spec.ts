import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ enabled: false, request: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native.enabled,
    getPlatform: () => "android",
  },
  CapacitorHttp: { request: native.request },
}));
import { apiFetch, configureNativeApi } from "../src/platform/api";

describe("transporte de API", () => {
  beforeEach(() => {
    native.enabled = false;
    native.request.mockReset();
  });
  it("mantém o fetch web relativo", async () => {
    const web = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", web);
    await apiFetch("/api/auth/session", { credentials: "same-origin" });
    expect(web).toHaveBeenCalledWith("/api/auth/session", {
      credentials: "same-origin",
    });
    vi.unstubAllGlobals();
  });
  it("encaminha a requisição nativa sem seguir redirecionamentos e preserva 304", async () => {
    native.enabled = true;
    configureNativeApi("https://pdv.brunosrz.com", ["pdv.brunosrz.com"]);
    native.request.mockResolvedValue({
      status: 304,
      data: "",
      headers: { etag: '"1"' },
    });
    const response = await apiFetch("/api/pdv/catalog", {
      headers: { "if-none-match": '"1"' },
    });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(native.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://pdv.brunosrz.com/api/pdv/catalog",
        disableRedirects: true,
        headers: expect.objectContaining({
          origin: "https://localhost",
          "if-none-match": '"1"',
        }),
      }),
    );
  });
  it("rejeita destinos externos e caminhos fora da API", async () => {
    expect(() =>
      configureNativeApi("https://example.com", ["pdv.brunosrz.com"]),
    ).toThrow();
    await expect(apiFetch("/api/../admin")).rejects.toThrow();
  });
  it("não trata redirecionamento do Access como login bem-sucedido", async () => {
    native.enabled = true;
    configureNativeApi("https://pdv.brunosrz.com", ["pdv.brunosrz.com"]);
    native.request.mockResolvedValue({
      status: 302,
      data: "",
      headers: {
        location: "https://access.example/login",
        "set-cookie": "session=secret",
      },
    });
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"username":"test"}',
    });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(native.request).toHaveBeenCalledWith(
      expect.objectContaining({
        disableRedirects: true,
        data: '{"username":"test"}',
      }),
    );
  });
});
