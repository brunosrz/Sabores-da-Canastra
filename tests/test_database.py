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


def test_json_configuration_roundtrip_preserves_ledger(tmp_path):
    ledger=Ledger(tmp_path/"source.db")
    ledger.upsert_ingredient(name="Farinha",base_unit="g",pack_quantity="1000",pack_price_cents=750,price_status="Estimado")
    ledger.replace_recipe(recipe_id="PAO_E",product_name="Pão",version="E",yield_units=10,source=None,instructions="",lines=[("Farinha","500","g","Massa")])
    ledger.upsert_product(product_id="pao",name="Pão",category="Salgados",sale_price_cents=700)
    ledger.set_mix("PAO_E",5,"E")
    ledger.upsert_parameter("dias","20","dias","Estimado")
    ledger.add_entry(entry_date="2026-11-01",kind="Venda",category="Salgados",description="Venda já feita",amount_cents=700)
    payload=ledger.export_configuration()
    assert payload["schema"]=="sabores-da-canastra/config"
    assert "entries" not in payload and "Venda já feita" not in str(payload)
    target=Ledger(tmp_path/"target.db")
    target.upsert_ingredient(name="Other",base_unit="un",pack_quantity="1",pack_price_cents=10)
    result=target.import_configuration(payload)
    assert result["ledger_preserved"] is True
    assert target.recipe("PAO_E")["lines"][0]["quantity"]=="500"
    assert target.list_products()[0]["sale_price_cents"]==700
    # Omitting catalog entries from an edited JSON does not remove them.
    assert {i["name"] for i in target.list_ingredients()}=={"Farinha","Other"}
    # Existing ledger rows survive a configuration update and are never imported/overwritten.
    target.add_entry(entry_date="2026-11-01",kind="Gasto",category="Gás",description="Botijão",amount_cents=14000)
    target.import_configuration(payload)
    assert len(target.list_entries())==1
    assert target.daily_summary("2026-11-01")["Gasto"]==14000


def test_json_import_rejects_invalid_recipe_atomically_and_keeps_ledger(tmp_path):
    ledger=Ledger(tmp_path/"invalid.db")
    ledger.upsert_ingredient(name="Leite",base_unit="ml",pack_quantity="1000",pack_price_cents=500)
    ledger.add_entry(entry_date="2026-11-01",kind="Compra",category="Insumos",description="Leite",amount_cents=500)
    payload=ledger.export_configuration()
    payload["ingredients"].append({"name":"Farinha","base_unit":"g","pack_quantity":"1000"})
    payload["recipes"]=[{"recipe_id":"R1","product_name":"Teste","version":"E","yield_units":1,
        "lines":[{"ingredient_name":"Leite","quantity":"10","unit":"g"}]}]
    with pytest.raises(ValueError):ledger.import_configuration(payload)
    assert [x["name"] for x in ledger.list_ingredients()]==["Leite"]
    assert len(ledger.list_entries())==1


def test_product_codes_roundtrip_and_are_unique(tmp_path):
    ledger = Ledger(tmp_path / "product-codes.db")
    ledger.upsert_product(product_id="internal-1", name="Refrigerante", category="Bebidas",
                          barcode="7890001", auxiliary_code="REF-01", sale_price_cents=600,
                          unit_cost_cents=350)
    payload = ledger.export_configuration()
    other = Ledger(tmp_path / "product-codes-copy.db")
    other.import_configuration(payload)
    product = other.list_products()[0]
    assert product["barcode"] == "7890001"
    assert product["auxiliary_code"] == "REF-01"
    assert product["unit_cost_cents"] == 350
    with pytest.raises(Exception):
        other.upsert_product(product_id="internal-2", name="Outro", category="Bebidas", barcode="7890001")


def test_bar_catalog_seeds_full_categories_and_preserves_user_changes(tmp_path):
    ledger = Ledger(tmp_path / "bar-catalog.db")
    ledger.upsert_product(product_id="default-brownie", name="Brownie intenso", category="Doces",
                          notes="Produto inicial sem preço; edite preço")
    added = ledger.seed_bar_catalog()
    products = ledger.list_products(active_only=True)
    categories = {product["category"] for product in products}
    assert {"Salgados", "Doces", "Molhos", "Lanches", "Pizzas", "Porções", "Bebidas"} <= categories
    by_name = {product["name"]: product for product in products}
    assert by_name["Contrafilé acebolado"]["sale_price_cents"] == 8500
    assert by_name["Cerveja lata 350 ml — Brahma"]["sale_price_cents"] == 600
    assert by_name["X-Salada"]["sale_price_cents"] == 1800
    assert by_name["Pizza de muçarela"]["sale_price_cents"] is None
    assert by_name["Creme de morango com chocolate"]["sale_price_cents"] == 900
    assert by_name["Monster 473 ml — Original"]["sale_price_cents"] == 1200
    assert by_name["Refrigerante 350 ml — Coca-Cola"]["sale_price_cents"] == 600
    assert by_name["Brownie de chocolate intenso"]["sale_price_cents"] == 700
    assert len([p for p in products if "Brownie" in p["name"]]) == 1
    assert added >= 40
    ledger.upsert_product(product_id=by_name["X-Salada"]["product_id"], name="X-Salada", category="Lanches",
                          sale_price_cents=2100, barcode="123456")
    assert ledger.seed_bar_catalog() == 0
    changed = next(product for product in ledger.list_products() if product["name"] == "X-Salada")
    assert changed["sale_price_cents"] == 2100
    assert changed["barcode"] == "123456"


def test_pos_sale_split_fees_cost_and_period_report(tmp_path):
    ledger = Ledger(tmp_path / "pos.db")
    sale = ledger.record_pos_sale(
        entry_date="2026-11-01",
        items=[
            {"name": "Salgado", "category": "Salgados", "quantity": "2", "unit_price_cents": 1000,
             "amount_cents": 2000, "unit_cost_cents": 400},
            {"name": "Monster", "category": "Bebidas", "quantity": "1", "unit_price_cents": 1200,
             "amount_cents": 1200, "unit_cost_cents": 500},
        ],
        payments=[
            {"method": "Dinheiro", "amount_cents": 500, "fee_rate": "0"},
            {"method": "Débito", "amount_cents": 1000, "fee_rate": "0.02"},
            {"method": "Crédito", "amount_cents": 1000, "fee_rate": "0.04"},
            {"method": "Pix", "amount_cents": 700, "fee_rate": "0"},
        ],
    )
    assert sale["gross_cents"] == 3200
    assert sale["fee_cents"] == 60
    assert sale["net_cents"] == 3140
    report = ledger.pos_report("2026-11-01", "2026-11-01")
    assert report["gross_cents"] == 3200
    assert report["fees_cents"] == 60
    assert report["known_cost_cents"] == 1300
    assert report["profit_cents"] == 1840
    assert report["payments"] == {"Dinheiro": 500, "Débito": 1000, "Crédito": 1000, "Pix": 700}
    assert len(ledger.list_entries(kind="Venda")) == 2


def test_pos_sale_requires_payment_split_and_removes_group_with_deleted_line(tmp_path):
    ledger = Ledger(tmp_path / "pos-integrity.db")
    item = {"name": "Doce", "category": "Doces", "quantity": "1", "unit_price_cents": 500, "amount_cents": 500}
    with pytest.raises(ValueError, match="soma"):
        ledger.record_pos_sale(entry_date="2026-11-01", items=[item],
                               payments=[{"method": "Pix", "amount_cents": 400, "fee_rate": "0"}])
    ledger.record_pos_sale(entry_date="2026-11-01", items=[item],
                           payments=[{"method": "Pix", "amount_cents": 500, "fee_rate": "0"}])
    entry = ledger.list_entries(kind="Venda")[0]
    assert ledger.delete_entry(entry.id)
    report = ledger.pos_report("2026-11-01", "2026-11-01")
    assert report["fees_cents"] == 0
    assert report["gross_cents"] == 0
