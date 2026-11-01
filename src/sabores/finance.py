"""Cálculos monetários determinísticos; nunca converte preço estimado em cotação."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
from math import ceil
from typing import Iterable

MONEY = Decimal("0.01")


def D(value: object) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def normalized_unit_cost(pack_price: object, pack_quantity: object) -> Decimal:
    quantity = D(pack_quantity)
    if quantity <= 0:
        raise ValueError("A quantidade da embalagem deve ser maior que zero")
    return D(pack_price) / quantity


def ingredient_cost(pack_price: object, pack_quantity: object, used_quantity: object) -> Decimal:
    return normalized_unit_cost(pack_price, pack_quantity) * D(used_quantity)


def recipe_batch_cost(components: Iterable[tuple[object, object, object]]) -> Decimal:
    """Cada tupla contém preço do pacote, tamanho do pacote e quantidade usada."""
    return sum((ingredient_cost(*component) for component in components), Decimal("0"))


def recipe_unit_cost(batch_cost: object, yield_units: object) -> Decimal:
    units = D(yield_units)
    if units <= 0:
        raise ValueError("O rendimento deve ser maior que zero")
    return D(batch_cost) / units


@dataclass(frozen=True)
class ProductionPlan:
    requested: int
    batches: int
    produced: int
    excess: int
    ingredient_cost: Decimal


def production_plan(requested: int, yield_units: int, batch_cost: object) -> ProductionPlan:
    if requested < 0 or yield_units <= 0:
        raise ValueError("Quantidade solicitada não pode ser negativa e o rendimento deve ser positivo")
    batches = ceil(requested / yield_units) if requested else 0
    produced = batches * yield_units
    return ProductionPlan(requested, batches, produced, produced - requested, D(batch_cost) * batches)


def fuel_cost(distance_km: object, km_per_litre: object, price_per_litre: object) -> Decimal:
    efficiency = D(km_per_litre)
    if efficiency <= 0:
        raise ValueError("Consumo da moto deve ser maior que zero")
    return D(distance_km) / efficiency * D(price_per_litre)


def card_fee_rate(debit_share: object, credit_share: object, debit_rate: object, credit_rate: object,
                  pix_share: object = 0, pix_rate: object = 0) -> Decimal:
    shares = [D(debit_share), D(credit_share), D(pix_share)]
    if any(s < 0 or s > 1 for s in shares) or sum(shares) > 1:
        raise ValueError("Participações devem estar entre 0% e 100%, somando no máximo 100%")
    return shares[0] * D(debit_rate) + shares[1] * D(credit_rate) + shares[2] * D(pix_rate)


@dataclass(frozen=True)
class FinanceResult:
    daily_revenue: Decimal
    monthly_revenue: Decimal
    monthly_savoury_revenue: Decimal
    monthly_drink_revenue: Decimal
    monthly_drink_cost: Decimal
    monthly_fuel_minimum: Decimal
    monthly_fuel_buffered: Decimal
    monthly_card_fees: Decimal
    reference_balance: Decimal
    buffered_reference_balance: Decimal


def baseline_finance(*, savouries_per_day=25, savoury_price=7, drinks_per_day=20,
                     drink_price=6, days_per_month=20, drink_cost=3.5,
                     km_minimum=22, km_buffer_pct=0.15, km_per_litre=40,
                     fuel_price=7, debit_share=0.25, credit_share=0.25,
                     debit_rate=0.0139, credit_rate=0.0334) -> FinanceResult:
    savoury_day = D(savouries_per_day) * D(savoury_price)
    drink_day = D(drinks_per_day) * D(drink_price)
    daily = savoury_day + drink_day
    days = D(days_per_month)
    savoury_month = savoury_day * days
    drink_month = drink_day * days
    drink_cost_month = D(drinks_per_day) * D(drink_cost) * days
    min_fuel = fuel_cost(D(km_minimum) * days, km_per_litre, fuel_price)
    buffered_fuel = fuel_cost(D(km_minimum) * (1 + D(km_buffer_pct)) * days,
                              km_per_litre, fuel_price)
    rate = card_fee_rate(debit_share, credit_share, debit_rate, credit_rate)
    card_fees = daily * days * rate
    balance = daily * days - drink_cost_month - min_fuel - card_fees
    buffered_balance = daily * days - drink_cost_month - buffered_fuel - card_fees
    return FinanceResult(daily, daily * days, savoury_month, drink_month, drink_cost_month,
                         min_fuel, buffered_fuel, card_fees, balance, buffered_balance)


def shopping_quantity(required: object, in_stock: object, pack_size: object) -> tuple[int, Decimal]:
    available = max(D(required) - D(in_stock), Decimal("0"))
    size = D(pack_size)
    if size <= 0:
        raise ValueError("Tamanho de embalagem deve ser maior que zero")
    packs = int((available / size).to_integral_value(rounding=ROUND_CEILING))
    return packs, available


def aggregate_ingredient_needs(rows: Iterable[tuple[str, object]]) -> dict[str, Decimal]:
    result: dict[str, Decimal] = {}
    for name, quantity in rows:
        result[name] = result.get(name, Decimal("0")) + D(quantity)
    return result
