import { env } from "cloudflare:test";

type Migration = { queries: string[] };
const runtime = env as Cloudflare.Env & { TEST_MIGRATIONS: Migration[] };
const migrations = runtime.TEST_MIGRATIONS;
for (const migration of migrations) {
  await runtime.DB.batch(
    migration.queries.map((query: string) => runtime.DB.prepare(query)),
  );
}
