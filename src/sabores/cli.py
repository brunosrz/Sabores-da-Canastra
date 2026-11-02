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

        source_paths = {
            Path(args.sqlite).expanduser().resolve(),
            path.expanduser().resolve(),
        }
        output_paths = []
        for argument in (args.saida, args.relatorio):
            if argument:
                output_paths.append(Path(argument).expanduser().resolve())
        if len(set(output_paths)) != len(output_paths):
            parser.error("Os caminhos de --saida e --relatorio precisam ser diferentes.")
        if set(output_paths) & source_paths:
            parser.error("Arquivos de saída não podem sobrescrever os arquivos de origem.")
        if args.comparar_com and output_paths and Path(args.comparar_com).expanduser().resolve() in output_paths:
            parser.error("Um arquivo usado em --comparar-com não pode ser sobrescrito nesta execução.")
        try:
            if args.command == "exportar-migracao-d1" and not args.saida:
                parser.error("exportar-migracao-d1 exige --saida <arquivo.json>")
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
            try:
                previous = _load_comparison_bundle(Path(args.comparar_com), bundle)
            except (OSError, json.JSONDecodeError, ValueError) as exc:
                print(f"Não foi possível comparar os pacotes: {exc}", file=sys.stderr)
                return 1
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


def _load_comparison_bundle(path: Path, current: dict) -> dict:
    value = json.loads(path.expanduser().read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("contract") != current.get("contract"):
        raise ValueError("o JSON precisa ser um pacote do mesmo contrato de migração")
    if value.get("contract_version") != current.get("contract_version"):
        raise ValueError("versão de contrato incompatível")
    tables = value.get("tables")
    financial = value.get("reconciliation", {}).get("financial") if isinstance(value.get("reconciliation"), dict) else None
    if not isinstance(tables, dict) or any(not isinstance(rows, list) for rows in tables.values()):
        raise ValueError("estrutura tables inválida")
    if not isinstance(financial, dict):
        raise ValueError("estrutura reconciliation.financial inválida")
    return value


def _write_json_report(value: dict, destination: str | Path) -> Path:
    from .d1_migration import write_import_bundle

    return write_import_bundle(value, destination)


if __name__ == "__main__":
    raise SystemExit(main())
