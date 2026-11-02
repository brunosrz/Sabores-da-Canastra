import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const baseDir = process.env.INIT_CWD ?? process.cwd();
const requestedPath =
  args[0] ??
  `.local/backups/sabores-canastra-${new Date()
    .toISOString()
    .replaceAll(":", "-")}.sql`;
const sqlPath = resolve(baseDir, requestedPath);
const manifestPath = `${sqlPath}.json`;
await mkdir(dirname(sqlPath), { recursive: true });
for (const outputPath of [sqlPath, manifestPath]) {
  try {
    await access(outputPath);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  throw new Error(`O arquivo de backup já existe: ${outputPath}`);
}

const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
    ),
    "d1",
    "export",
    "sabores-canastra-local",
    "--local",
    "--skip-confirmation",
    "--config",
    fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
    "--output",
    sqlPath,
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const sql = await readFile(sqlPath);
const manifest = {
  contract: "sabores-da-canastra/d1-backup",
  contract_version: 1,
  database_id: "local",
  bookmark: "local-export",
  created_at: new Date().toISOString(),
  sql_key: "backups/d1/local-export.sql",
  size_bytes: sql.byteLength,
  sha256: createHash("sha256").update(sql).digest("hex"),
  restore:
    "Valide o hash e restaure em um D1 isolado antes de substituir qualquer banco.",
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: "wx",
});
console.log(`Backup local criado: ${sqlPath}`);
console.log(`Manifesto criado: ${manifestPath}`);
