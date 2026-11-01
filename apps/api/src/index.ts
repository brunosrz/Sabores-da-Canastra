import { Hono } from "hono";
import { importBundle } from "./import";

type Bindings = {
  DB: D1Database;
  LOCAL_IMPORT_TOKEN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (context) =>
  context.json({ app: "sabores-api", status: "ok" }),
);

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
  if (context.req.header("authorization") !== `Bearer ${expectedToken}`) {
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
    return context.json(await importBundle(context.env.DB, payload));
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
