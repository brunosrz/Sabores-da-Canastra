import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [sqlPath, manifestPath] = args;
if (!sqlPath || !manifestPath) {
  throw new Error(
    "Uso: pnpm db:restore:validate -- <backup.sql> <manifest.json>",
  );
}

const baseDir = process.env.INIT_CWD ?? process.cwd();
const resolvedSqlPath = resolve(baseDir, sqlPath);
const resolvedManifestPath = resolve(baseDir, manifestPath);
const sql = await readFile(resolvedSqlPath);
const manifest = JSON.parse(await readFile(resolvedManifestPath, "utf8"));
const sha256 = createHash("sha256").update(sql).digest("hex");
if (
  !manifest ||
  typeof manifest !== "object" ||
  manifest.contract !== "sabores-da-canastra/d1-backup" ||
  manifest.contract_version !== 1 ||
  typeof manifest.sql_key !== "string" ||
  !manifest.sql_key.startsWith("backups/d1/") ||
  !Number.isSafeInteger(manifest.size_bytes) ||
  manifest.size_bytes !== sql.byteLength ||
  typeof manifest.sha256 !== "string" ||
  manifest.sha256 !== sha256
) {
  throw new Error(
    "Backup ou manifesto inválido: contrato, tamanho ou SHA-256 divergente.",
  );
}

const persistPath = await mkdtemp(
  resolve(tmpdir(), "sabores-canastra-restore-"),
);
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
    ),
    "d1",
    "execute",
    "sabores-canastra-restore-validation",
    "--local",
    "--config",
    fileURLToPath(
      new URL("./restore-validation.wrangler.jsonc", import.meta.url),
    ),
    "--file",
    resolvedSqlPath,
    "--persist-to",
    persistPath,
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Backup íntegro restaurado no D1 temporário: ${persistPath}`);
