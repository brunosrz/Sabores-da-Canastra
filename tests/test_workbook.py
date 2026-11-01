from pathlib import Path
import shutil

from openpyxl import load_workbook

from sabores.workbook import enhance_workbook, inspect_workbook, validate_workbook, workbook_financial_summary


SOURCE = Path(__file__).resolve().parents[1] / "sabores_da_canastra_custos_salgados.xlsx"


def test_existing_workbook_structure_is_preserved(tmp_path):
    copy = tmp_path / SOURCE.name
    shutil.copy2(SOURCE, copy)
    before = inspect_workbook(copy)
    assert before["formulas"] >= 1272
    assert before["sheets"][0]["name"] == "Painel"
    enhance_workbook(copy, backup=False)
    wb = load_workbook(copy, data_only=False)
    assert {"Painel", "Parametros", "Insumos", "Fichas", "Composicao", "Mix diario", "Fontes", "Compras"}.issubset(wb.sheetnames)
    assert {"Pesquisa de preços", "Estoque", "Vendas", "Historico", "Cenarios", "Producao"}.issubset(wb.sheetnames)
    assert wb["Insumos"].max_row == 34
    assert wb["Fichas"].max_row == 20
    assert wb["Composicao"].max_row == 193
    assert wb.calculation.fullCalcOnLoad is True
    assert not validate_workbook(copy)


def test_workbook_financial_summary_has_reference_values():
    result = workbook_financial_summary(SOURCE)
    assert round(float(result["monthly_revenue"]), 2) == 5900
    assert round(float(result["monthly_drink_cost"]), 2) == 1400
    assert round(float(result["monthly_fuel_minimum"]), 2) == 77
    assert round(float(result["monthly_fuel_buffered"]), 2) == 88.55
    assert round(float(result["monthly_card_fees"]), 2) == 69.77
    assert round(float(result["reference_balance"]), 2) == 4353.23


def test_validation_detects_invalid_payment_shares(tmp_path):
    copy = tmp_path / SOURCE.name
    shutil.copy2(SOURCE, copy)
    wb = load_workbook(copy)
    wb["Parametros"]["B18"] = 0.8
    wb["Parametros"]["B19"] = 0.4
    wb.save(copy)
    assert any("Participações" in error for error in validate_workbook(copy))
