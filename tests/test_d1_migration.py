import json
import hashlib
import gc
import sqlite3
from pathlib import Path

import pytest

from sabores.d1_migration import (
    MigrationValidationError,
    build_import_bundle,
    compare_import_bundles,
    write_import_bundle,
)
from sabores.database import Ledger

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "apps" / "api" / "migrations" / "0001_initial_schema.sql"


def test_comparison_rejects_invalid_financial_structure(tmp_path):
	from sabores.cli import _load_comparison_bundle

	path = tmp_path / "invalid.json"
	path.write_text(json.dumps({"contract": "test", "contract_version": 1, "tables": {}, "reconciliation": {"financial": []}}), encoding="utf-8")
	with pytest.raises(ValueError, match=r"reconciliation\.financial"):
		_load_comparison_bundle(path, {"contract": "test", "contract_version": 1})


@pytest.fixture
def workbook(tmp_path):
	from openpyxl import Workbook

	book = Workbook()
	book.active.title = "Painel"
	for name in ("Parametros", "Insumos", "Fichas", "Composicao", "Mix diario", "Fontes", "Compras"):
		book.create_sheet(name)
	params = book["Parametros"]
	params["B7"] = 1
	for cell in ("B18", "B19", "B20", "B21", "B38", "B39"):
		params[cell] = 0
	book["Insumos"].append([None] * 7)
	book["Insumos"].append([None] * 7)
	book["Insumos"].append([None] * 7)
	book["Insumos"].append(["INGREDIENTE", "UNID. BASE", "QTD. NO PACOTE", "PREÇO PACOTE"])
	book["Insumos"].append(["Farinha de trigo", "g", 1000, 8.2])
	book["Insumos"].append(["Queijo", "g", 1000, 20])
	book["Fichas"].append([None] * 19)
	book["Fichas"].append([None] * 19)
	book["Fichas"].append([None] * 19)
	book["Fichas"].append(["ID RECEITA", "ID SABOR", "PRODUTO", "VERSÃO", "RENDE", "FONTE", "PREPARO"])
	book["Fichas"].append(["JOELHO_E", "JOELHO", "Joelho", "Econômica", 14, None, "Misturar"])
	book["Fichas"].append(["PIZZA_E", "PIZZA", "Pizza", "Econômica", 10, None, "Assar"])
	book["Composicao"].append([None] * 9)
	book["Composicao"].append([None] * 9)
	book["Composicao"].append([None] * 9)
	book["Composicao"].append(["ID RECEITA", "ETAPA", "INGREDIENTE", "QTDE", "UNID."])
	book["Composicao"].append(["JOELHO_E", "Massa", "Farinha de trigo", 500, "g"])
	book["Composicao"].append(["PIZZA_E", "Recheio", "Queijo", 300, "g"])
	book["Mix diario"].append([None] * 16)
	book["Mix diario"].append([None] * 16)
	book["Mix diario"].append([None] * 16)
	book["Mix diario"].append(["ID SABOR", "PRODUTO", "QTD/DIA", "VERSÃO"])
	book["Mix diario"].append(["JOELHO", "Joelho", 1, "E"])
	book["Mix diario"].append(["PIZZA", "Pizza", 0, "E"])
	path = tmp_path / "source.xlsx"
	book.save(path)
	return path


def test_bundle_merges_workbook_and_sqlite_and_reconciles_financial_history(tmp_path, workbook):
	database = tmp_path / "legacy.db"
	ledger = Ledger(database)
	ledger.upsert_ingredient(name="Farinha de trigo", base_unit="g", pack_quantity="1000",
							pack_price_cents=820, price_status="Confirmado", price_date="2026-10-30",
							supplier="Fornecedor editado")
	ledger.upsert_ingredient(name="Item adicional", base_unit="un", pack_quantity="1", pack_price_cents=25)
	ledger.upsert_recipe(recipe_id="JOELHO_E", product_name="Joelho editado", version="E", yield_units=11,
						 lines=[("Farinha de trigo", "400", "g", "Massa")])
	ledger.upsert_product(product_id="suco", name="Suco", category="Bebidas", sale_price_cents=500,
						 unit_cost_cents=200, barcode="789100")
	ledger.record_pos_sale(entry_date="2026-11-01", items=[{
		"name": "Suco", "category": "Bebidas", "quantity": 2, "unit_price_cents": 500,
		"amount_cents": 1000, "unit_cost_cents": 200,
	}], payments=[{"method": "Dinheiro", "amount_cents": 400, "fee_rate": "0"},
				  {"method": "Crédito", "amount_cents": 600, "fee_rate": "0.02"}], customer="Balcão")
	ledger.add_entry(entry_date="2026-11-01", kind="Compra", category="Insumos", description="Farinha",
				  amount_cents=820, quantity="1", unit_price_cents=820, payment_method="Pix",
				  supplier_or_customer="Fornecedor")
	ledger.add_entry(entry_date="2026-11-01", kind="Gasto", category="Gás", description="Botijão",
				  amount_cents=12000, payment_method="Dinheiro")
	legacy_report = ledger.pos_report("2026-11-01", "2026-11-01")
	assert (legacy_report["gross_cents"], legacy_report["fees_cents"], legacy_report["net_cents"],
			legacy_report["known_cost_cents"], legacy_report["profit_cents"]) == (1000, 12, 988, 400, 588)

	def byte_hashes():
		paths = [database, workbook, Path(f"{database}-wal")]
		return {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths if path.is_file()}
	gc.collect()
	bytes_before = byte_hashes()
	bundle = build_import_bundle(database, workbook)
	assert byte_hashes() == bytes_before
	second = build_import_bundle(database, workbook)
	assert bundle["import_id"] == second["import_id"]
	assert bundle["row_counts"]["ingredients"] == 3
	assert bundle["row_counts"]["recipes"] == 2
	assert bundle["row_counts"]["recipeLines"] == 2
	assert bundle["row_counts"]["quotes"] == 3
	assert bundle["row_counts"]["ledgerEntries"] == 3
	assert bundle["reconciliation"]["financial"]["Venda"]["matches"] is True
	assert bundle["reconciliation"]["financial"]["Compra"]["source_cents"] == 820
	assert bundle["reconciliation"]["financial"]["Gasto"]["source_cents"] == 12000
	merged_ingredient = next(row for row in bundle["tables"]["ingredients"] if row["name"] == "Farinha de trigo")
	assert merged_ingredient["supplier"] == "Fornecedor editado"
	assert len([row for row in bundle["tables"]["quotes"] if row["ingredientId"] == merged_ingredient["ingredientId"]]) == 1
	sale = bundle["tables"]["sales"][0]
	assert (sale["grossCents"], sale["feeCents"], sale["netCents"]) == (1000, 12, 988)
	assert bundle["tables"]["saleItems"][0]["unitCostCents"] == 200
	assert bundle["tables"]["saleItems"][0]["productId"] == "suco"
	assert bundle["tables"]["ledgerEntries"][0]["occurredOn"] == "2026-11-01"
	assert bundle["tables"]["ledgerEntries"][0]["occurredAt"].endswith("Z")
	assert bundle["provenance"]["timezone"] == "America/Sao_Paulo"
	assert bundle["provenance"]["source_files"]["sqlite"]["sha256"] == bundle["source"]["sqlite_file_sha256"]


def test_migration_bundle_is_written_atomically_and_can_be_compared(tmp_path, workbook, monkeypatch):
	database = tmp_path / "ledger.db"
	Ledger(database)
	bundle = build_import_bundle(database, workbook)
	destination = tmp_path / "reports" / "bundle.json"
	assert write_import_bundle(bundle, destination) == destination
	assert destination.exists()
	loaded = json.loads(destination.read_text(encoding="utf-8"))
	comparison = compare_import_bundles(bundle, loaded)
	assert comparison["same_import"] is True
	assert all(line["delta"] == 0 for line in comparison["tables"].values())
	assert comparison["financial"]["Venda"]["source_cents"]["delta"] == 0

	destination.write_text("preexistente", encoding="utf-8")
	def fail_replace(source, target):
		raise OSError("falha simulada ao substituir")
	monkeypatch.setattr("sabores.d1_migration.os.replace", fail_replace)
	with pytest.raises(OSError, match="falha simulada"):
		write_import_bundle(bundle, destination)
	assert destination.read_text(encoding="utf-8") == "preexistente"
	assert list(destination.parent.glob(f".{destination.name}.*.tmp")) == []


def test_cli_writes_reviewable_dry_run_report(tmp_path, workbook, capsys):
	from sabores.cli import main

	database = tmp_path / "ledger.db"
	Ledger(database)
	report = tmp_path / "review" / "dry-run.json"
	assert main([
		"prever-migracao-d1",
		"--excel", str(workbook),
		"--sqlite", str(database),
		"--relatorio", str(report),
	]) == 0
	assert report.exists()
	output = json.loads(capsys.readouterr().out)
	assert output["mode"] == "dry-run"
	assert output["report_file"] == str(report.resolve())
	assert json.loads(report.read_text(encoding="utf-8"))["valid"] is True


def test_cli_rejects_output_path_collisions_before_writing(tmp_path, workbook):
	from sabores.cli import main

	database = tmp_path / "ledger.db"
	Ledger(database)
	with pytest.raises(SystemExit) as error:
		main(["exportar-migracao-d1", "--excel", str(workbook), "--sqlite", str(database), "--saida", str(database)])
	assert error.value.code == 2


def test_cli_reports_invalid_migration_with_exit_code_one(tmp_path, workbook, capsys, monkeypatch):
	from sabores.cli import main
	from sabores import d1_migration

	database = tmp_path / "ledger.db"
	Ledger(database)
	def invalid_bundle(*_args, **_kwargs):
		raise MigrationValidationError(["dados inválidos"])
	monkeypatch.setattr(d1_migration, "build_import_bundle", invalid_bundle)
	assert main(["prever-migracao-d1", "--excel", str(workbook), "--sqlite", str(database)]) == 1
	assert json.loads(capsys.readouterr().out)["valid"] is False


def test_cli_rejects_bad_comparison_before_export_artifacts(tmp_path, workbook, capsys):
	from sabores.cli import main

	database = tmp_path / "ledger.db"
	Ledger(database)
	comparison = tmp_path / "previous.json"
	comparison.write_text("{broken", encoding="utf-8")
	destination = tmp_path / "bundle.json"
	assert main([
		"exportar-migracao-d1", "--excel", str(workbook), "--sqlite", str(database),
		"--saida", str(destination), "--comparar-com", str(comparison),
	]) == 1
	assert not destination.exists()
	assert "Não foi possível comparar" in capsys.readouterr().err


def test_source_fingerprint_includes_wal_for_any_suffix(tmp_path):
	from sabores.d1_migration import _source_fingerprint

	source = tmp_path / "legacy.data"
	source.write_bytes(b"database")
	Path(f"{source}-wal").write_bytes(b"wal")
	fingerprint = _source_fingerprint(source)
	assert [component["name"] for component in fingerprint["components"]] == [
		"legacy.data", "legacy.data-wal",
	]


def test_rejects_unbalanced_legacy_sale_without_producing_partial_bundle(tmp_path, workbook):
	database = tmp_path / "unbalanced.db"
	ledger = Ledger(database)
	ledger.record_pos_sale(entry_date="2026-11-01", items=[{
		"name": "Produto", "category": "Outros", "quantity": 1,
		"unit_price_cents": 1000, "amount_cents": 1000,
	}], payments=[{"method": "Pix", "amount_cents": 1000, "fee_rate": "0"}])
	with sqlite3.connect(database) as db:
		db.execute("UPDATE sale_payments SET amount_cents=900")

	with pytest.raises(MigrationValidationError, match="pagamentos totalizam"):
		build_import_bundle(database, workbook)


def test_rejects_negative_legacy_ledger_amount(tmp_path, workbook):
	database = tmp_path / "negative.db"
	ledger = Ledger(database)
	ledger.add_entry(entry_date="2026-11-01", kind="Gasto", category="Teste", description="Invalid",
					 amount_cents=10)
	with sqlite3.connect(database) as db:
		db.execute("PRAGMA ignore_check_constraints=ON")
		db.execute("UPDATE entries SET amount_cents=-10")

	with pytest.raises(MigrationValidationError, match="valor negativo"):
		build_import_bundle(database, workbook)


def test_d1_schema_enforces_append_only_ledger_and_integer_money(tmp_path):
	database = sqlite3.connect(tmp_path / "schema.db")
	database.execute("PRAGMA foreign_keys=ON")
	schema = SCHEMA.read_text(encoding="utf-8")
	database.executescript(schema)
	objects_before = database.execute(
		"SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
	).fetchall()
	columns_before = database.execute("PRAGMA table_info(products)").fetchall()
	# Reapplying the schema must not duplicate tables, indexes, triggers, or columns.
	database.executescript(schema)
	assert database.execute(
		"SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
	).fetchall() == objects_before
	assert database.execute("PRAGMA table_info(products)").fetchall() == columns_before
	database.execute("INSERT INTO categories(category_id,name,created_at) VALUES('drinks','Bebidas','2026-11-01T00:00:00Z')")
	database.execute("""INSERT INTO ledger_entries(ledger_id,idempotency_key,entry_type,occurred_on,recorded_at,
		amount_cents,description,category,source_system,source_id)
		VALUES('entry-1','key-1','expense','2026-11-01','2026-11-01T00:00:00Z',100,'Teste','Outros','test','1')""")
	with pytest.raises(sqlite3.IntegrityError, match="append-only"):
		database.execute("UPDATE ledger_entries SET amount_cents=200 WHERE ledger_id='entry-1'")
	with pytest.raises(sqlite3.IntegrityError, match="append-only"):
		database.execute("DELETE FROM ledger_entries WHERE ledger_id='entry-1'")
	with pytest.raises(sqlite3.IntegrityError):
		database.execute("""INSERT INTO ledger_entries(ledger_id,idempotency_key,entry_type,occurred_on,recorded_at,
			amount_cents,description,category,source_system,source_id)
			VALUES('entry-negative','key-negative','expense','2026-11-01','2026-11-01T00:00:00Z',-1,'Inválido','Outros','test','negative')""")
	database.close()
