import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(apiRoot, "../..");
const args = process.argv.slice(2).filter((value) => value !== "--");
const bundlePath = resolve(repositoryRoot, args[0] ?? "");
if (!args[0]) {
  console.error("Uso: pnpm db:import:local -- <pacote-json>");
  process.exit(2);
}

const vars = await readFile(resolve(apiRoot, ".dev.vars"), "utf8").catch(
  () => "",
);
const token = vars.match(/^LOCAL_IMPORT_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token || token.length < 32) {
  console.error(
    "Configure LOCAL_IMPORT_TOKEN com pelo menos 32 caracteres em apps/api/.dev.vars.",
  );
  process.exit(2);
}

const bundle = await readFile(bundlePath, "utf8");
const response = await fetch("http://127.0.0.1:3000/__local/import", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: bundle,
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
