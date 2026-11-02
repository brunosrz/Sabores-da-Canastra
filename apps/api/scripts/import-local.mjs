import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(apiRoot, "../..");
const args = process.argv.slice(2).filter((value) => value !== "--");
const apply = args.includes("--aplicar");
const bundleArgument = args.find((value) => value !== "--aplicar");
const bundlePath = resolve(repositoryRoot, bundleArgument ?? "");
if (!bundleArgument) {
  console.error("Uso: pnpm db:import:local -- <pacote-json> [--aplicar]");
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
const endpoint = "http://127.0.0.1:3000/__local/import";
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
const previewResponse = await fetch(`${endpoint}?mode=preview`, {
  method: "POST",
  headers,
  body: bundle,
});
const preview = await previewResponse.json().catch(() => ({}));
console.log(JSON.stringify({ etapa: "preview", ...preview }, null, 2));
if (!previewResponse.ok || preview.state === "occupied") {
  process.exit(1);
}
if (preview.state === "already_imported") {
  console.log("Este pacote já foi importado; nenhuma nova gravação foi enviada.");
  process.exit(0);
}
if (!apply) {
  console.log(
    "Preview concluído sem gravação. Revise o relatório e use --aplicar para confirmar.",
  );
  process.exit(0);
}

const response = await fetch(endpoint, {
  method: "POST",
  headers,
  body: bundle,
});
const result = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ etapa: "importação", ...result }, null, 2));
