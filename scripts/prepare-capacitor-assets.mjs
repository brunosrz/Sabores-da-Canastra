import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const app = process.argv[2];
if (app !== "erp" && app !== "pdv") throw new Error("Informe erp ou pdv.");
const root = resolve(import.meta.dirname, "..", "apps", app, "dist");
const source = resolve(root, "client");
const target = resolve(root, "mobile");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
await cp(resolve(source, "_shell.html"), resolve(target, "index.html"));
