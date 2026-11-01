from decimal import Decimal

import pytest

from sabores.finance import (
    aggregate_ingredient_needs, baseline_finance, card_fee_rate, fuel_cost,
    ingredient_cost, production_plan, recipe_unit_cost, shopping_quantity,
)


def test_ingredient_normalization_and_recipe_cost():
    assert ingredient_cost(7.5, 1000, 500) == Decimal("3.75")
    assert ingredient_cost(29, 30, 2) == Decimal("1.933333333333333333333333333")
    assert recipe_unit_cost(30, 12) == Decimal("2.5")


def test_zero_or_negative_pack_and_yield_rejected():
    with pytest.raises(ValueError):
        ingredient_cost(10, 0, 1)
    with pytest.raises(ValueError):
        recipe_unit_cost(10, 0)


def test_production_batches_keep_excess_as_stock():
    plan = production_plan(25, 14, Decimal("28"))
    assert (plan.batches, plan.produced, plan.excess) == (2, 28, 3)
    assert plan.ingredient_cost == Decimal("56")


def test_fuel_minimum_and_buffer():
    assert fuel_cost(22, 40, 7) == Decimal("3.85")
    assert fuel_cost(25.3, 40, 7) == Decimal("4.4275")


def test_card_fee_weighting_and_validation():
    rate = card_fee_rate(.25, .25, .0139, .0334)
    assert rate == Decimal("0.011825")
    with pytest.raises(ValueError):
        card_fee_rate(.8, .4, .01, .02)


def test_monthly_reference_values_exact():
    result = baseline_finance()
    assert result.daily_revenue == Decimal("295")
    assert result.monthly_revenue == Decimal("5900")
    assert result.monthly_drink_cost == Decimal("1400.0")
    assert result.monthly_fuel_minimum == Decimal("77.000")
    assert result.monthly_fuel_buffered == Decimal("88.55000")
    assert result.monthly_card_fees == Decimal("69.7675000")
    assert result.reference_balance.quantize(Decimal("0.01")) == Decimal("4353.23")
    assert result.buffered_reference_balance.quantize(Decimal("0.01")) == Decimal("4341.68")


def test_shopping_and_aggregated_requirements():
    assert shopping_quantity(2.3, 0, 1) == (3, Decimal("2.3"))
    needs = aggregate_ingredient_needs([("Farinha", 1.2), ("Farinha", 1.1), ("Ovos", 3)])
    assert needs == {"Farinha": Decimal("2.3"), "Ovos": Decimal("3")}
