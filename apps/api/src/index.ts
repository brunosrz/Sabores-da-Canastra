import { Hono } from "hono";
import { importBundle } from "./import";
import { invalidateCatalogCache, listProducts } from "./catalog-cache";
import { verifyBackupStream } from "./backup";
import {
  currentUser,
  hasTrustedOrigin,
  login,
  logout,
  sessionResponse,
  type AuthBindings,
  type AuthUser,
} from "./auth";
export { SaleCoordinator } from "./sale-coordinator";
export { D1BackupWorkflow } from "./backup";

type Bindings = {
  DB: D1Database;
  CATALOG_CACHE: KVNamespace;
  PRIVATE_FILES: R2Bucket;
  SALE_COORDINATOR: DurableObjectNamespace;
  D1_BACKUP: Workflow;
  BACKUP_ACCOUNT_ID?: string;
  BACKUP_DATABASE_ID?: string;
  LOCAL_IMPORT_TOKEN?: string;
  AUTH_USERS?: string;
  AUTH_COOKIE_DOMAIN?: string;
  AUTH_COOKIE_NAME?: string;
  AUTH_ALLOWED_ORIGINS?: string;
};

const app = new Hono<{
  Bindings: Bindings;
  Variables: { authUser: AuthUser };
}>();
const MAX_SALE_BODY_BYTES = 1_000_000;
const MAX_LOGIN_BODY_BYTES = 16_384;
const PUBLIC_AUTH_ROUTES = new Set([
  "POST /api/auth/login",
  "GET /api/auth/session",
  "POST /api/auth/logout",
]);

async function readBodyWithinLimit(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the size-limit response if cancellation is unavailable.
        }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function authenticatedUser(context: {
  req: { raw: Request };
  env: Bindings;
}): Promise<AuthUser | null> {
  try {
    return await currentUser(context.req.raw, context.env as AuthBindings);
  } catch {
    return null;
  }
}

function unauthorized(context: {
  json: (body: unknown, status?: number) => Response;
}): Response {
  return context.json({ error: "Não autenticado." }, 401);
}

async function bearerMatches(
  authorization: string | undefined,
  expectedToken: string | undefined,
): Promise<boolean> {
  if (!authorization || !expectedToken) return false;
  const actual = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(actual)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedToken)),
  ]);
  const left = new Uint8Array(actualDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left[index]! ^ right[index]!;
  return difference === 0 && authorization.startsWith("Bearer ");
}

app.get("/health", (context) =>
  context.json({ app: "sabores-api", status: "ok" }),
);

app.post("/api/auth/login", async (context) => {
  const bytes = await readBodyWithinLimit(
    context.req.raw.body,
    MAX_LOGIN_BODY_BYTES,
  );
  if (!bytes)
    return context.json({ error: "Corpo de login excede 16 KB." }, 413);
  const bodyBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(bodyBuffer).set(bytes);
  return login(
    new Request(context.req.raw.url, {
      method: "POST",
      headers: context.req.raw.headers,
      body: bodyBuffer,
    }),
    context.env as AuthBindings,
  );
});
app.get("/api/auth/session", (context) =>
  sessionResponse(context.req.raw, context.env as AuthBindings),
);
app.post("/api/auth/logout", (context) =>
  logout(context.req.raw, context.env as AuthBindings),
);

app.use("/api/*", async (context, next) => {
  if (PUBLIC_AUTH_ROUTES.has(`${context.req.method} ${context.req.path}`))
    return next();
  const user = await authenticatedUser(context);
  if (!user) return unauthorized(context);
  context.set("authUser", user);
  await next();
});

app.get("/api/catalog/products", async (context) => {
  try {
    const result = await listProducts(
      context.env.DB,
      context.env.CATALOG_CACHE,
    );
    return context.json(result);
  } catch (error) {
    console.error("Falha ao consultar catálogo no D1.", error);
    return context.json({ error: "Catálogo indisponível." }, 503);
  }
});

app.post("/api/sales", async (context) => {
  const user = context.get("authUser");
  if (!hasTrustedOrigin(context.req.raw, context.env as AuthBindings))
    return context.json({ error: "Solicitação inválida." }, 403);
  const idempotencyKey = context.req.header("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return context.json(
      { error: "Informe uma chave de idempotência válida." },
      400,
    );
  }
  const contentLength = Number(context.req.header("content-length") ?? "0");
  if (contentLength > MAX_SALE_BODY_BYTES) {
    try {
      await context.req.raw.body?.cancel();
    } catch {
      // A runtime may already have consumed or locked the request stream.
    }
    return context.json({ error: "Corpo da venda excede 1 MB." }, 413);
  }
  let requestBytes: Uint8Array | null;
  try {
    requestBytes = await readBodyWithinLimit(
      context.req.raw.body,
      MAX_SALE_BODY_BYTES,
    );
  } catch {
    return context.json(
      { error: "Não foi possível ler o corpo da venda." },
      400,
    );
  }
  if (!requestBytes) {
    return context.json({ error: "Corpo da venda excede 1 MB." }, 413);
  }
  const requestBody = new TextDecoder().decode(requestBytes);
  const coordinator = context.env.SALE_COORDINATOR.getByName(idempotencyKey);
  const response = await coordinator.fetch(
    new Request("https://sale-coordinator.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "x-actor-user-id": user.id,
      },
      body: requestBody,
    }),
  );
  return new Response(response.body, response);
});

app.get("/api/backups", async (context) => {
  const page = await context.env.PRIVATE_FILES.list({
    prefix: "backups/d1/",
    limit: 1000,
  });
  const manifests = page.objects.filter((object) =>
    object.key.endsWith(".json"),
  );
  return context.json({
    backups: manifests.map((object) => ({
      key: object.key,
      uploaded: object.uploaded.toISOString(),
    })),
  });
});

app.post("/api/backups/run", async (context) => {
  if (!hasTrustedOrigin(context.req.raw, context.env as AuthBindings))
    return context.json({ error: "Solicitação inválida." }, 403);
  if (
    context.env.BACKUP_ACCOUNT_ID === "local" ||
    context.env.BACKUP_DATABASE_ID === "local"
  ) {
    return context.json(
      {
        error:
          "A exportação do D1 local é feita pelo comando pnpm --filter @sabores/api db:backup:local.",
      },
      409,
    );
  }
  const key = context.req.header("idempotency-key") ?? crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{8,90}$/.test(key)) {
    return context.json(
      { error: "Informe uma chave de idempotência válida." },
      400,
    );
  }
  const id = `manual-${key}`;
  let instance;
  let created = true;
  try {
    instance = await context.env.D1_BACKUP.create({ id });
  } catch (error) {
    try {
      created = false;
      instance = await context.env.D1_BACKUP.get(id);
    } catch {
      console.error("Falha ao iniciar Workflow de backup.", error);
      return context.json({ error: "Não foi possível iniciar o backup." }, 503);
    }
  }
  const status = await instance.status();
  return context.json(
    { id: instance.id, status: status.status },
    created ? 202 : 200,
  );
});

app.get("/api/backups/file/*", async (context) => {
  let key: string;
  try {
    key = decodeURIComponent(
      context.req.path.slice("/api/backups/file/".length),
    );
  } catch {
    return context.json({ error: "Not found" }, 404);
  }
  if (
    !key.startsWith("backups/d1/") ||
    key.includes("..") ||
    key.includes("\\")
  ) {
    return context.json({ error: "Not found" }, 404);
  }
  let object = await context.env.PRIVATE_FILES.get(key);
  if (!object) return context.json({ error: "Not found" }, 404);
  if (key.endsWith(".sql")) {
    const manifest = await context.env.PRIVATE_FILES.get(
      key.replace(/\.sql$/, ".json"),
    );
    if (
      !manifest ||
      !object.body ||
      !(await verifyBackupStream(object.body, await manifest.text(), key))
    ) {
      return context.json(
        { error: "Backup não passou na validação de integridade." },
        409,
      );
    }
    const verifiedEtag = object.httpEtag;
    object = await context.env.PRIVATE_FILES.get(key);
    if (!object || object.httpEtag !== verifiedEtag) {
      return context.json(
        { error: "Backup foi alterado durante a validação." },
        409,
      );
    }
  }
  return new Response(object.body, {
    headers: {
      "content-type":
        object.httpMetadata?.contentType ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${key.split("/").at(-1)}"`,
      "cache-control": "private, no-store",
      etag: object.httpEtag,
    },
  });
});

app.post("/__local/import", async (context) => {
  const hostname = new URL(context.req.url).hostname;
  const expectedToken = context.env.LOCAL_IMPORT_TOKEN;
  if (
    !["127.0.0.1", "localhost"].includes(hostname) ||
    !expectedToken ||
    expectedToken.length < 32
  ) {
    return context.notFound();
  }
  if (
    !(await bearerMatches(context.req.header("authorization"), expectedToken))
  ) {
    return context.json({ error: "Unauthorized" }, 401);
  }
  const contentLength = Number(context.req.header("content-length") ?? "0");
  if (contentLength > 5_000_000)
    return context.json({ error: "Pacote excede 5 MB." }, 413);
  let payload: unknown;
  try {
    const raw = await context.req.text();
    if (new TextEncoder().encode(raw).byteLength > 5_000_000)
      return context.json({ error: "Pacote excede 5 MB." }, 413);
    payload = JSON.parse(raw);
  } catch {
    return context.json({ error: "Corpo não é JSON válido." }, 400);
  }
  try {
    const result = await importBundle(context.env.DB, payload);
    await invalidateCatalogCache(context.env.CATALOG_CACHE);
    return context.json(result);
  } catch (error) {
    return context.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao importar pacote.",
      },
      422,
    );
  }
});

app.notFound((context) => context.json({ error: "Not found" }, 404));

export default app;
