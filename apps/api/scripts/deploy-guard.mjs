import { readFile } from "node:fs/promises";

const environment = process.argv[2];
if (!new Set(["preview", "production"]).has(environment)) {
  throw new Error("Informe um ambiente explícito: preview ou production.");
}

const source = await readFile(
  new URL("../wrangler.jsonc", import.meta.url),
  "utf8",
);
const json = source.replace(/,\s*([}\]])/g, "$1");
const config = JSON.parse(json);
const target = config.env?.[environment];
if (!target)
  throw new Error(`Ambiente ${environment} não está declarado no Wrangler.`);

const d1 = target.d1_databases?.[0];
const kv = target.kv_namespaces?.[0];
const bucket = target.r2_buckets?.[0];
const values = [
  d1?.database_id,
  kv?.id,
  bucket?.bucket_name,
  target.workflows?.[0]?.name,
  target.vars?.BACKUP_ACCOUNT_ID,
  target.vars?.BACKUP_DATABASE_ID,
  target.vars?.BACKUP_RETENTION_DAYS,
];
const exampleIds = new Set([
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
  "00000000-0000-0000-0000-000000000003",
  "00000000000000000000000000000001",
  "00000000000000000000000000000002",
  "00000000000000000000000000000003",
]);
if (
  values.some(
    (value) => !value || /REPLACE/.test(value) || exampleIds.has(value),
  )
) {
  throw new Error(
    `Bindings ${environment} ainda têm identificadores de exemplo. Crie recursos isolados e substitua os identificadores antes do deploy.`,
  );
}

const other = config.env[environment === "preview" ? "production" : "preview"];
const otherValues = [
  other.d1_databases?.[0]?.database_id,
  other.kv_namespaces?.[0]?.id,
  other.r2_buckets?.[0]?.bucket_name,
];
if (values.slice(0, 3).some((value) => otherValues.includes(value))) {
  throw new Error(
    "Preview e produção não podem compartilhar D1, KV ou bucket R2.",
  );
}

console.log(`Bindings de ${environment} parecem provisionados e isolados.`);
