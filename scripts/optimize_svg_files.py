"""Format SVG files in place with the repository-pinned SVGO CLI."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVGO_CLI = ROOT / "node_modules" / "svgo" / "bin" / "svgo.js"
CONFIG = ROOT / "svgo.config.mjs"


def main() -> None:
    if sys.argv[1:] == ["--pre-commit"]:
        ignored = {".git", ".venv", "node_modules", "dist", ".wrangler"}
        files = sorted(
            path.resolve()
            for path in ROOT.rglob("*.svg")
            if not ignored.intersection(path.relative_to(ROOT).parts)
        )
    else:
        files = [Path(value).resolve() for value in sys.argv[1:]]
    if not files:
        raise SystemExit("Informe ao menos um arquivo SVG para formatar.")
    if any(path.suffix.lower() != ".svg" for path in files):
        raise SystemExit("O formatador aceita somente arquivos .svg.")
    node = shutil.which("node.exe") or shutil.which("node")
    if not node or not SVGO_CLI.is_file():
        raise SystemExit("Instale as dependências JavaScript com pnpm install.")

    subprocess.run(
        [
            node,
            str(SVGO_CLI),
            "--multipass",
            "--pretty",
            "--final-newline",
            "--quiet",
            "--config",
            str(CONFIG),
            *map(str, files),
        ],
        cwd=ROOT,
        check=True,
    )
    if os.environ.get("SABORES_GENERATING_BRAND_ASSETS") != "1":
        pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
        if not pnpm:
            raise SystemExit("pnpm não foi encontrado para gerar os assets da marca.")
        subprocess.run([pnpm, "assets:brand"], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
