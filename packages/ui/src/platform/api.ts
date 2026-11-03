import { Capacitor, CapacitorHttp } from "@capacitor/core";

let nativeOrigin: string | undefined;

/** The installed shell chooses its own first-party BFF; no credentials are embedded. */
export function configureNativeApi(
  origin: string,
  allowedHosts: readonly string[],
) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    !allowedHosts.includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Origem do serviço nativo inválida.");
  }
  nativeOrigin = url.origin;
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (
    !path.startsWith("/api/") ||
    path.startsWith("//") ||
    /[\\#]/.test(path) ||
    !new URL(path, "https://localhost").pathname.startsWith("/api/")
  )
    throw new Error("Caminho de API inválido.");
  if (!Capacitor.isNativePlatform()) return fetch(path, init);
  if (!nativeOrigin) throw new Error("Serviço nativo não configurado.");
  const url = new URL(path, nativeOrigin);
  if (url.origin !== nativeOrigin || !url.pathname.startsWith("/api/"))
    throw new Error("Caminho de API inválido.");
  if (init.signal?.aborted)
    throw new DOMException("Operação cancelada.", "AbortError");
  if (init.body != null && typeof init.body !== "string")
    throw new Error("Formato de envio nativo não suportado.");
  const sourceHeaders = new Headers(init.headers);
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "if-none-match", "idempotency-key"]) {
    const value = sourceHeaders.get(name);
    if (value) headers[name] = value;
  }
  headers.origin =
    Capacitor.getPlatform() === "ios"
      ? "capacitor://localhost"
      : "https://localhost";
  const response = await CapacitorHttp.request({
    url: url.href,
    method: init.method ?? "GET",
    headers,
    data: init.body ?? undefined,
    disableRedirects: true,
    responseType: "text",
  });
  if (init.signal?.aborted)
    throw new DOMException("Operação cancelada.", "AbortError");
  const resultHeaders = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (!["set-cookie", "set-cookie2"].includes(name.toLowerCase()))
      resultHeaders.set(name, String(value));
  }
  const noBody = [204, 205, 304].includes(response.status);
  const body = noBody
    ? null
    : typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data ?? null);
  return new Response(body, {
    status: response.status,
    headers: resultHeaders,
  });
}
