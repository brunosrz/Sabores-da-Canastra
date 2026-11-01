import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
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

const sql = await readFile(resolve(sqlPath));
const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
const sha256 = createHash("sha256").update(sql).digest("hex");
if (
  manifest.contract !== "sabores-da-canastra/d1-backup" ||
  manifest.contract_version !== 1 ||
  basename(manifest.sql_key) !== basename(sqlPath) ||
  manifest.size_bytes !== sql.byteLength ||
  manifest.sha256 !== sha256
) {
  throw new Error(
    "Backup ou manifesto inválido: contrato, tamanho ou SHA-256 divergente.",
  );
}

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
    "scripts/restore-validation.wrangler.jsonc",
    "--file",
    resolve(sqlPath),
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("Backup íntegro restaurado no D1 local isolado de validação.");
