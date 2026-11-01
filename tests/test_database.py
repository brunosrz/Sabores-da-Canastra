from datetime import date

import pytest

from sabores.database import Ledger
from sabores.desktop import format_money, parse_money


def test_ledger_daily_monthly_and_filters(tmp_path):
    ledger = Ledger(tmp_path / "test.db")
    ledger.add_entry(entry_date="2026-11-01", kind="Venda", category="Salgados",
                     description="Vendas do dia", amount_cents=17500, payment_method="Pix")
    ledger.add_entry(entry_date="2026-11-01", kind="Compra", category="Ingredientes",
                     description="Farinha", amount_cents=7500)
    ledger.add_entry(entry_date="2026-10-30", kind="Gasto", category="Combustível",
                     description="Gasolina", amount_cents=385)
    assert ledger.daily_summary("2026-11-01") == {"Venda": 17500, "Compra": 7500, "Gasto": 0, "Resultado": 10000}
    assert ledger.monthly_summary(2026, 11)["Resultado"] == 10000
    assert len(ledger.list_entries(start_date="2026-11-01", kind="Venda")) == 1


def test_ledger_validates_and_deletes(tmp_path):
    ledger = Ledger(tmp_path / "test.db")
    with pytest.raises(ValueError):
        ledger.add_entry(entry_date="2026-02-30", kind="Gasto", category="Gás", description="Gás", amount_cents=1)
    with pytest.raises(ValueError):
        ledger.add_entry(entry_date="2026-11-01", kind="Compra", category="", description="", amount_cents=1)
    entry = ledger.add_entry(entry_date="2026-11-01", kind="Gasto", category="Gás", description="Botijão", amount_cents=14000)
    assert ledger.delete_entry(entry.id)
    assert not ledger.delete_entry(entry.id)


def test_money_input_display():
    assert parse_money("R$ 1.234,56") == 123456
    assert parse_money("12.50") == 1250
    assert format_money(123456) == "R$ 1.234,56"
    with pytest.raises(ValueError):
        parse_money("0")


def test_recipe_cost_and_mix_with_pending_prices(tmp_path):
    ledger = Ledger(tmp_path / "test.db")
    ledger.upsert_ingredient(name="Farinha", base_unit="g", pack_quantity="1000",
                             pack_price_cents=750, price_status="Estimado")
    ledger.upsert_ingredient(name="Queijo", base_unit="g", pack_quantity="1000")
    ledger.upsert_recipe(recipe_id="JOELHO_E", product_name="Joelho", version="E",
                         yield_units=10, lines=[("Farinha", "500", "g", "Massa"), ("Queijo", "200", "g", "Recheio")])
    result = ledger.recipe_cost("JOELHO_E")
    assert result["unit_cost_cents"] is None
    assert result["pending_ingredients"] == ["Queijo"]
    ledger.upsert_ingredient(name="Queijo", base_unit="g", pack_quantity="1000", pack_price_cents=2000)
    result = ledger.recipe_cost("JOELHO_E")
    assert result["batch_cost_cents"] == 775
    assert result["unit_cost_cents"] == 78
    ledger.set_mix("JOELHO_E", 5, "E")
    assert ledger.list_mix()[0]["quantity"] == 5


def test_recipe_cost_uses_decimal_precision(tmp_path):
    ledger = Ledger(tmp_path / "precision.db")
    ledger.upsert_ingredient(name="Ovos", base_unit="un", pack_quantity="30", pack_price_cents=2900)
    ledger.upsert_recipe(recipe_id="OVO_E", product_name="Teste", version="E", yield_units=3,
                         lines=[("Ovos", "2", "un", "Massa")])
    result = ledger.recipe_cost("OVO_E")
    assert result["batch_cost_cents"] == 193
