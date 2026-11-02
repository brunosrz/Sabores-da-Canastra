"""Interface local para inspecionar, validar e atualizar o arquivo Excel."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .finance import baseline_finance, money
from .workbook import enhance_workbook, inspect_workbook, validate_workbook, workbook_financial_summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sabores", description="Custos e planejamento Sabores da Canastra")
    parser.add_argument("command", choices=["app", "inspecionar", "validar", "atualizar-excel", "simular", "calcular-receitas", "planejar-producao", "gerar-compras", "prever-migracao-d1", "exportar-migracao-d1"])
    parser.add_argument("--excel", default="sabores_da_canastra_custos_salgados.xlsx", help="Caminho do arquivo xlsx")
    parser.add_argument("--sqlite", default=str(Path.home() / ".sabores-da-canastra" / "sabores.db"), help="Caminho do SQLite legado")
    parser.add_argument("--saida", help="Caminho do pacote JSON de migração (exige exportar-migracao-d1)")
    parser.add_argument("--relatorio", help="Grava relatório JSON de validação/dry-run")
    parser.add_argument("--comparar-com", help="Compara com um pacote JSON anterior")
    parser.add_argument("--quantidade", type=int, default=25, help="Quantidade solicitada para planejar (comando de produção)")
    args = parser.parse_args(argv)
    if args.command == "app":
        from .desktop import main as desktop_main
        desktop_main()
        return 0
    path = Path(args.excel)
    if args.command in {"prever-migracao-d1", "exportar-migracao-d1"}:
        from .d1_migration import (
            MigrationValidationError,
            build_import_bundle,
            compare_import_bundles,
            write_import_bundle,
        )

        try:
            if args.command == "exportar-migracao-d1" and not args.saida:
                parser.error("exportar-migracao-d1 exige --saida <arquivo.json>")
            if args.saida:
                output_path = Path(args.saida).expanduser().resolve()
                source_paths = {
                    Path(args.sqlite).expanduser().resolve(),
                    path.expanduser().resolve(),
                }
                if output_path in source_paths:
                    parser.error("O pacote de saída não pode sobrescrever os arquivos de origem.")
            bundle = build_import_bundle(args.sqlite, path)
        except MigrationValidationError as exc:
            report = {"valid": False, "errors": exc.errors, **exc.report}
            if args.relatorio:
                _write_json_report(report, args.relatorio)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 1
        summary = {
            "valid": True,
            "mode": "dry-run" if args.command == "prever-migracao-d1" else "export",
            "contract": bundle["contract"],
            "contract_version": bundle["contract_version"],
            "import_id": bundle["import_id"],
            "provenance": bundle["provenance"],
            "row_counts": bundle["row_counts"],
            "reconciliation": bundle["reconciliation"],
        }
        if args.comparar_com:
            previous = json.loads(Path(args.comparar_com).read_text(encoding="utf-8"))
            summary["comparison"] = compare_import_bundles(bundle, previous)
        if args.command == "exportar-migracao-d1":
            summary["file"] = str(write_import_bundle(bundle, args.saida).resolve())
        if args.relatorio:
            _write_json_report(summary, args.relatorio)
            summary["report_file"] = str(Path(args.relatorio).resolve())
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    if args.command == "inspecionar":
        print(json.dumps(inspect_workbook(path), ensure_ascii=False, indent=2))
        return 0
    if args.command == "atualizar-excel":
        enhance_workbook(path)
        print(f"Planilha atualizada: {path.resolve()}")
        return 0
    if args.command == "validar":
        issues = validate_workbook(path)
        if issues:
            print("\n".join(f"ERRO: {item}" for item in issues))
            return 1
        print("Planilha válida: estrutura, referências, quantidades e mix conferidos.")
        return 0
    if args.command == "simular":
        print(json.dumps(workbook_financial_summary(path), ensure_ascii=False, indent=2))
        return 0
    if args.command in {"calcular-receitas", "planejar-producao", "gerar-compras"}:
        print(f"{args.command}: use a integração pela planilha; consulte README para campos e fluxo.")
        return 0
    return 2


def _write_json_report(value: dict, destination: str | Path) -> Path:
    from .d1_migration import write_import_bundle

    return write_import_bundle(value, destination)


if __name__ == "__main__":
    raise SystemExit(main())
