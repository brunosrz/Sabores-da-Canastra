"""Validação e exportação segura do SQLite/Excel legado para D1."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import os
import shutil
import tempfile
from typing import Iterator
from zoneinfo import ZoneInfo

from .workbook import validate_workbook

CONTRACT = "sabores-da-canastra/d1-import"
CONTRACT_VERSION = 1
SAO_PAULO = ZoneInfo("America/Sao_Paulo")
UTC = timezone.utc
INGREDIENT_NAMESPACE = "53d1baf9-38e3-5d42-bbd6-76e6e21bf989"


class MigrationValidationError(ValueError):
    """Falhas de origem que impedem gerar um pacote importável."""

    def __init__(self, errors: list[str], report: dict | None = None):
        self.errors = errors
        self.report = report or {}
        super().__init__("\n".join(errors))


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _text(value: object | None) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def _money(value: object | None) -> int | None:
    if value is None:
        return None
    amount = Decimal(str(value))
    if not amount.is_finite() or amount < 0:
        raise ValueError(f"Valor monetário inválido: {value}")
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _slug(value: str) -> str:
    folded = value.casefold()
    return re.sub(r"[^a-z0-9]+", "-", folded.encode("ascii", "ignore").decode()).strip("-") or "item"


def _stable_ingredient_id(name: str) -> str:
    import uuid

    return str(uuid.uuid5(uuid.UUID(INGREDIENT_NAMESPACE), name.casefold().strip()))


def _source_fingerprint(path: Path, component_names: set[str] | None = None) -> dict:
    """Hash SQLite data files; the shared-memory index is transient and excluded."""
    files = [path]
    wal_path = Path(f"{path}-wal")
    if wal_path.is_file():
        files.append(wal_path)
    components = []
    for source in files:
        if component_names is not None and source.name not in component_names:
            continue
        if not source.exists():
            if component_names is not None and source.name in component_names:
                components.append({"name": source.name, "missing": True})
            continue
        before = source.stat()
        content = source.read_bytes()
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or len(content) != after.st_size:
            raise MigrationValidationError([f"Arquivo de origem mudou durante a leitura: {source.name}"])
        components.append({"name": source.name, "sha256": hashlib.sha256(content).hexdigest(), "size_bytes": len(content), "mtime_ns": after.st_mtime_ns})
    stable_components = [
        {
            key: component[key]
            for key in ("name", "sha256", "size_bytes", "missing")
            if key in component
        }
        for component in components
    ]
    canonical = json.dumps(stable_components, sort_keys=True, separators=(",", ":")).encode()
    return {
        "sha256": components[0]["sha256"] if len(components) == 1 else hashlib.sha256(canonical).hexdigest(),
        "size_bytes": sum(item.get("size_bytes", 0) for item in components),
        "components": components,
    }


@contextmanager
def _validated_sqlite_snapshot(path: Path) -> Iterator[tuple[Path, dict]]:
    """Copy a consistent SQLite/WAL pair and remove it on every exit path."""
    with tempfile.TemporaryDirectory(prefix="sabores-d1-source-") as directory:
        snapshot = Path(directory) / path.name
        fingerprint = _source_fingerprint(path)
        shutil.copy2(path, snapshot)
        source_wal = Path(f"{path}-wal")
        if source_wal.is_file():
            shutil.copy2(source_wal, Path(f"{snapshot}-wal"))
        final_fingerprint = _source_fingerprint(path)
        if final_fingerprint["sha256"] != fingerprint["sha256"]:
            raise MigrationValidationError(["SQLite de origem mudou durante a cópia; nenhum pacote foi produzido."])
        yield snapshot, fingerprint


def _instant(value: str | None) -> str | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=SAO_PAULO)
    return parsed.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _schema_tables(db: sqlite3.Connection) -> set[str]:
    return {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _read_workbook(path: Path, captured_at: str) -> tuple[dict, dict, list[str]]:
    from openpyxl import load_workbook

    errors = validate_workbook(path)
    if errors:
        return {}, {}, [f"Workbook: {error}" for error in errors]
    wb = load_workbook(path, data_only=False, read_only=True)
    ingredients: dict[str, dict] = {}
    quotes: dict[str, dict] = {}
    recipes: dict[str, dict] = {}
    lines_by_recipe: dict[str, list[dict]] = {}
    parameters: dict[str, dict] = {}
    mix: dict[str, dict] = {}

    for row_no in range(5, wb["Insumos"].max_row + 1):
        row = wb["Insumos"]
        name = _text(row.cell(row_no, 1).value)
        if not name:
            continue
        unit = _text(row.cell(row_no, 2).value)
        quantity = str(row.cell(row_no, 3).value)
        ingredient_id = _stable_ingredient_id(name)
        ingredients[name.casefold()] = {
            "ingredientId": ingredient_id, "name": name, "baseUnit": unit,
            "packQuantity": quantity, "supplier": None, "notes": _text(row.cell(row_no, 7).value),
            "createdAt": captured_at, "updatedAt": captured_at,
        }
        quote_id = f"workbook-ingredient-{_slug(name)}"
        quotes[name.casefold()] = {
            "quoteId": quote_id, "ingredientId": ingredient_id,
            "packPriceCents": _money(row.cell(row_no, 4).value), "packQuantity": quantity,
            "baseUnit": unit, "supplier": None, "quotedOn": None,
            "status": "Estimado", "source": "Planilha Excel legada; preço estimado",
            "notes": _text(row.cell(row_no, 7).value), "isCurrent": 1, "createdAt": captured_at,
        }

    for row_no in range(5, wb["Composicao"].max_row + 1):
        row = wb["Composicao"]
        recipe_id = _text(row.cell(row_no, 1).value)
        if not recipe_id:
            continue
        name = _text(row.cell(row_no, 3).value)
        ingredient = ingredients.get((name or "").casefold())
        if ingredient is None:
            errors.append(f"Composicao!C{row_no}: ingrediente não mapeado: {name}")
            continue
        lines_by_recipe.setdefault(recipe_id, []).append({
            "lineId": f"workbook-line-{row_no}", "recipeId": recipe_id,
            "ingredientId": ingredient["ingredientId"], "quantity": str(row.cell(row_no, 4).value),
            "unit": _text(row.cell(row_no, 5).value), "stage": _text(row.cell(row_no, 2).value),
        })

    selected: dict[str, tuple[str, int]] = {}
    for row_no in range(5, wb["Mix diario"].max_row + 1):
        row = wb["Mix diario"]
        flavor = _text(row.cell(row_no, 1).value)
        quantity = row.cell(row_no, 3).value
        if flavor and isinstance(quantity, (int, float)) and not isinstance(quantity, bool):
            if int(quantity) != quantity or quantity < 0:
                errors.append(f"Mix diario!C{row_no}: quantidade precisa ser inteiro não negativo")
                continue
            selected[flavor] = ("E" if str(row.cell(row_no, 4).value or "E").upper().startswith("E") else "R",
                                int(quantity))

    for row_no in range(5, wb["Fichas"].max_row + 1):
        row = wb["Fichas"]
        recipe_id = _text(row.cell(row_no, 1).value)
        if not recipe_id:
            continue
        product_name = _text(row.cell(row_no, 3).value) or ""
        version = "E" if str(row.cell(row_no, 4).value).casefold().startswith("econ") else "R"
        raw_yield = row.cell(row_no, 5).value
        if not isinstance(raw_yield, (int, float)) or isinstance(raw_yield, bool) or raw_yield <= 0 or int(raw_yield) != raw_yield:
            errors.append(f"Fichas!E{row_no}: rendimento precisa ser inteiro positivo")
            continue
        recipes[recipe_id] = {
            "recipeId": recipe_id, "productName": product_name, "version": version,
            "yieldUnits": int(raw_yield), "source": _text(row.cell(row_no, 6).value),
            "instructions": _text(row.cell(row_no, 7).value), "createdAt": captured_at,
            "updatedAt": captured_at,
        }
        flavor = _text(row.cell(row_no, 2).value) or ""
        choice = selected.get(flavor)
        if choice and choice[0] == version:
            mix[recipe_id] = {"recipeId": recipe_id, "quantity": choice[1], "selectedVersion": version}

    for row_no in range(6, min(wb["Parametros"].max_row, 39) + 1):
        row = wb["Parametros"]
        name = _text(row.cell(row_no, 1).value)
        value = row.cell(row_no, 2).value
        if not name or value is None or isinstance(value, str) and value.startswith("="):
            continue
        parameters[_slug(name)] = {
            "name": _slug(name), "value": str(value), "unit": _text(row.cell(row_no, 3).value),
            "status": "Estimado", "updatedAt": captured_at,
        }

    wb.close()
    return ({"ingredients": list(ingredients.values()), "quotes": list(quotes.values()),
             "recipes": list(recipes.values()),
             "recipeLines": [line for lines in lines_by_recipe.values() for line in lines],
             "parameters": list(parameters.values()), "dailyMix": list(mix.values())},
            {"ingredients": len(ingredients), "recipes": len(recipes),
             "recipeLines": sum(map(len, lines_by_recipe.values())),
             "parameters": len(parameters), "dailyMix": len(mix)}, errors)


def _merge_config(workbook: dict, sqlite_config: dict) -> dict:
    """Merge by stable business key; SQLite wins because it includes user edits."""
    merged = dict(workbook)
    sqlite_ingredient_ids = {row["ingredientId"] for row in sqlite_config.get("ingredients", [])}
    merged["quotes"] = [row for row in merged.get("quotes", [])
                        if row["ingredientId"] not in sqlite_ingredient_ids]
    sqlite_recipe_ids = {row["recipeId"] for row in sqlite_config.get("recipes", [])}
    merged["recipeLines"] = [row for row in merged.get("recipeLines", [])
                             if row["recipeId"] not in sqlite_recipe_ids]
    key_fields = {
        "ingredients": "name", "quotes": "quoteId", "recipes": "recipeId",
        "recipeLines": "lineId", "parameters": "name", "dailyMix": "recipeId",
        "categories": "categoryId", "products": "productId",
    }
    for table, key in key_fields.items():
        rows = {row[key]: row for row in merged.get(table, [])}
        for row in sqlite_config.get(table, []):
            rows[row[key]] = row
        merged[table] = list(rows.values())
    return merged


def _sqlite_config(db: sqlite3.Connection, captured_at: str, errors: list[str]) -> tuple[dict, dict]:
    tables = _schema_tables(db)
    required = {"products", "ingredients", "recipes", "recipe_lines", "parameters", "daily_mix"}
    if missing := required - tables:
        errors.append(f"SQLite sem tabelas obrigatórias: {', '.join(sorted(missing))}")
        return {}, {}
    ingredients_by_name: dict[str, dict] = {}
    quotes: list[dict] = []
    for row in db.execute("SELECT * FROM ingredients ORDER BY name"):
        ingredient_id = _stable_ingredient_id(row["name"])
        if row["base_unit"] not in {"g", "ml", "un"}:
            errors.append(f"ingredients.name={row['name']}: unidade base inválida: {row['base_unit']}")
        try:
            pack_quantity = Decimal(str(row["pack_quantity"]))
            if not pack_quantity.is_finite() or pack_quantity <= 0:
                raise ValueError
        except Exception:
            errors.append(f"ingredients.name={row['name']}: quantidade da embalagem inválida")
        if row["price_status"] not in {"Confirmado", "Estimado", "Pendente", "Desatualizado"}:
            errors.append(f"ingredients.name={row['name']}: status de preço inválido")
        ingredients_by_name[row["name"].casefold()] = {
            "ingredientId": ingredient_id, "name": row["name"], "baseUnit": row["base_unit"],
            "packQuantity": str(row["pack_quantity"]), "supplier": row["supplier"], "notes": row["notes"],
            "createdAt": captured_at, "updatedAt": captured_at,
        }
        if row["pack_price_cents"] is not None or row["price_status"]:
            quotes.append({
                "quoteId": f"sqlite-ingredient-{_slug(row['name'])}", "ingredientId": ingredient_id,
                "packPriceCents": row["pack_price_cents"], "packQuantity": str(row["pack_quantity"]),
                "baseUnit": row["base_unit"], "supplier": row["supplier"], "quotedOn": row["price_date"],
                "status": row["price_status"], "source": row["source"], "notes": row["notes"],
                "isCurrent": 1, "createdAt": captured_at,
            })
    recipes: list[dict] = []
    recipe_lines: list[dict] = []
    for row in db.execute("SELECT * FROM recipes ORDER BY recipe_id"):
        recipes.append({
            "recipeId": row["recipe_id"], "productName": row["product_name"], "version": row["version"],
            "yieldUnits": row["yield_units"], "source": row["source"], "instructions": row["instructions"],
            "createdAt": captured_at, "updatedAt": captured_at,
        })
    for row in db.execute("SELECT * FROM recipe_lines ORDER BY id"):
        ingredient = ingredients_by_name.get(row["ingredient_name"].casefold())
        if not ingredient:
            errors.append(f"recipe_lines.id={row['id']}: ingrediente ausente {row['ingredient_name']}")
            continue
        try:
            quantity = Decimal(str(row["quantity"]))
            if not quantity.is_finite() or quantity < 0 or row["unit"] != ingredient["baseUnit"]:
                raise ValueError
        except Exception:
            errors.append(f"recipe_lines.id={row['id']}: quantidade ou unidade inválida")
            continue
        recipe_lines.append({
            "lineId": f"sqlite-recipe-line-{row['id']}", "recipeId": row["recipe_id"],
            "ingredientId": ingredient["ingredientId"], "quantity": str(quantity),
            "unit": row["unit"], "stage": row["stage"],
        })
    categories: dict[str, dict] = {}
    products: list[dict] = []
    for row in db.execute("SELECT * FROM products ORDER BY product_id"):
        category = row["category"]
        category_id = _slug(category)
        categories[category_id] = {"categoryId": category_id, "name": category, "createdAt": captured_at}
        products.append({
            "productId": row["product_id"], "barcode": row["barcode"], "auxiliaryCode": row["auxiliary_code"],
            "name": row["name"], "categoryId": category_id, "unit": row["unit"],
            "salePriceCents": row["sale_price_cents"], "unitCostCents": row["unit_cost_cents"],
            "active": row["active"], "notes": row["notes"], "createdAt": captured_at, "updatedAt": captured_at,
        })
    parameters = [{"name": row["name"], "value": row["value"], "unit": row["unit"],
                   "status": row["status"], "updatedAt": captured_at}
                  for row in db.execute("SELECT * FROM parameters ORDER BY name")]
    daily_mix = [{"recipeId": row["recipe_id"], "quantity": row["quantity"],
                  "selectedVersion": row["version"]}
                 for row in db.execute("SELECT * FROM daily_mix ORDER BY recipe_id")]
    return ({"ingredients": list(ingredients_by_name.values()), "quotes": quotes, "recipes": recipes,
             "recipeLines": recipe_lines, "categories": list(categories.values()), "products": products,
             "parameters": parameters, "dailyMix": daily_mix},
            {"ingredients": len(ingredients_by_name), "quotes": len(quotes), "recipes": len(recipes),
             "recipeLines": len(recipe_lines), "categories": len(categories), "products": len(products),
             "parameters": len(parameters), "dailyMix": len(daily_mix)})


def _financial_history(db: sqlite3.Connection, captured_at: str, errors: list[str]) -> dict:
    tables = _schema_tables(db)
    if "entries" not in tables:
        errors.append("SQLite sem tabela entries")
        return {"ledgerEntries": [], "sales": [], "saleItems": [], "salePayments": [],
                "purchases": [], "purchaseItems": [], "expenses": []}
    entries = [dict(row) for row in db.execute("SELECT * FROM entries ORDER BY id")]
    groups = {row["group_id"]: dict(row) for row in db.execute("SELECT * FROM sale_groups")} if "sale_groups" in tables else {}
    payments_by_group: dict[str, list[dict]] = {}
    if "sale_payments" in tables:
        for row in db.execute("SELECT * FROM sale_payments ORDER BY id"):
            payments_by_group.setdefault(row["group_id"], []).append(dict(row))
    for entry in entries:
        if not isinstance(entry.get("amount_cents"), int) or entry["amount_cents"] < 0:
            errors.append(f"entries.id={entry['id']}: valor deve ser inteiro não negativo em centavos")
        for field in ("unit_price_cents", "unit_cost_cents"):
            value = entry.get(field)
            if value is not None and (not isinstance(value, int) or value < 0):
                errors.append(f"entries.id={entry['id']}: {field} inválido")
        if entry.get("quantity") is not None:
            try:
                quantity = Decimal(str(entry["quantity"]))
                if not quantity.is_finite() or quantity <= 0:
                    raise ValueError
            except Exception:
                errors.append(f"entries.id={entry['id']}: quantidade inválida")
        try:
            date_value = datetime.fromisoformat(entry["entry_date"]).date().isoformat()
            if date_value != entry["entry_date"]:
                raise ValueError
        except ValueError:
            errors.append(f"entries.id={entry['id']}: data inválida: {entry['entry_date']}")
    for group_id, payments in payments_by_group.items():
        if group_id not in groups:
            errors.append(f"sale_payments.group_id={group_id}: cabeçalho de venda ausente")
        for payment in payments:
            try:
                amount = payment["amount_cents"]
                rate = Decimal(str(payment["fee_rate"]))
                if not isinstance(amount, int) or amount < 0 or not rate.is_finite() or rate < 0:
                    raise ValueError
            except Exception:
                errors.append(f"sale_payments.id={payment.get('id')}: valor/taxa inválidos")
    grouped_entries: dict[str, list[dict]] = {}
    loose_entries: list[dict] = []
    marker = re.compile(r"\[sale_group:([^\]]+)\]")
    for entry in entries:
        if entry["kind"] == "Venda":
            found = marker.search(entry.get("notes") or "")
            if found:
                grouped_entries.setdefault(found.group(1), []).append(entry)
            else:
                loose_entries.append(entry)

    ledger_entries: list[dict] = []
    sales: list[dict] = []
    sale_items: list[dict] = []
    sale_payments: list[dict] = []
    purchases: list[dict] = []
    purchase_items: list[dict] = []
    expenses: list[dict] = []
    params = {row["name"]: row["value"] for row in db.execute("SELECT * FROM parameters")} if "parameters" in tables else {}
    rate_by_method = {"Dinheiro": Decimal(0), "Pix": Decimal(0),
                      "Débito": Decimal(params.get("pos_debit_rate", "0.0139")),
                      "Crédito": Decimal(params.get("pos_credit_rate", "0.0334")), "Outro": Decimal(0)}

    def make_ledger(*, ledger_id: str, key: str, entry_type: str, entry_date: str, created_at: str | None,
                    amount: int, description: str, category: str, counterparty: str | None, notes: str | None,
                    source_id: str) -> dict:
        try:
            occurred = datetime.fromisoformat(entry_date).date().isoformat()
            if occurred != entry_date:
                raise ValueError
        except ValueError:
            errors.append(f"{source_id}: data de operação inválida: {entry_date}")
        if amount < 0:
            errors.append(f"{source_id}: valor negativo")
        try:
            occurred_at = _instant(created_at)
        except (ValueError, OverflowError):
            occurred_at = None
            errors.append(f"{source_id}: instante de auditoria inválido: {created_at}")
        return {"ledgerId": ledger_id, "idempotencyKey": key, "entryType": entry_type,
                "occurredOn": entry_date, "occurredAt": occurred_at, "recordedAt": captured_at,
                "amountCents": amount, "currency": "BRL", "description": description or "(sem descrição)",
                "category": category or "(sem categoria)", "counterparty": counterparty, "notes": notes,
                "sourceSystem": "sqlite-legacy", "sourceId": source_id, "correctionOf": None,
                "correctionReason": None, "importId": None}

    def add_sale(sale_id: str, group: dict | None, lines: list[dict], payment_rows: list[dict], legacy_id: str) -> None:
        gross = sum(int(line["amount_cents"]) for line in lines)
        expected_gross = int(group["total_cents"]) if group else gross
        payment_total = sum(int(payment["amount_cents"]) for payment in payment_rows)
        if gross != expected_gross:
            errors.append(f"{legacy_id}: itens totalizam {gross}, cabeçalho da venda {expected_gross}")
        if payment_rows and payment_total != expected_gross:
            errors.append(f"{legacy_id}: pagamentos totalizam {payment_total}, venda {expected_gross}")
        if not payment_rows:
            errors.append(f"{legacy_id}: venda sem pagamentos associados")
        exact_fees = [Decimal(int(p["amount_cents"])) * Decimal(str(p.get("fee_rate", 0))) for p in payment_rows]
        total_fee = int(sum(exact_fees, Decimal(0)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        fee_parts = [int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)) for value in exact_fees]
        if fee_parts:
            fee_parts[-1] += total_fee - sum(fee_parts)
        created_at = (group or {}).get("created_at") or lines[0].get("created_at")
        first = lines[0]
        ledger_entries.append(make_ledger(
            ledger_id=f"legacy-sale:{sale_id}", key=f"sqlite:sale:{sale_id}", entry_type="sale",
            entry_date=(group or {}).get("entry_date", first["entry_date"]), created_at=created_at,
            amount=expected_gross, description=f"Venda {sale_id}", category="Venda",
            counterparty=first.get("supplier_or_customer"), notes=first.get("notes"), source_id=sale_id))
        sales.append({"saleId": sale_id, "ledgerId": f"legacy-sale:{sale_id}", "grossCents": expected_gross,
                      "feeCents": total_fee, "netCents": expected_gross - total_fee,
                      "customer": first.get("supplier_or_customer"), "notes": first.get("notes"),
                      "createdAt": ledger_entries[-1]["occurredAt"] or captured_at})
        product_rows = [dict(row) for row in db.execute("SELECT product_id,name,category FROM products")] if "products" in tables else []
        product_map = {row["name"].casefold(): row for row in product_rows}
        for line in lines:
            quantity = str(line.get("quantity") or "1")
            unit_price = line.get("unit_price_cents")
            if unit_price is None:
                try:
                    unit_price = int((Decimal(line["amount_cents"]) / Decimal(quantity)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
                except Exception:
                    errors.append(f"entries.id={line['id']}: quantidade/preço da venda inválido")
                    unit_price = int(line["amount_cents"])
            product = product_map.get(line["description"].casefold())
            sale_items.append({
                "itemId": f"legacy-sale-item-{line['id']}", "saleId": sale_id,
                "productId": product["product_id"] if product else None,
                "productNameSnapshot": line["description"],
                "categorySnapshot": line["category"], "quantity": quantity,
                "unitPriceCents": int(unit_price), "unitCostCents": line.get("unit_cost_cents"),
                "lineTotalCents": int(line["amount_cents"]), "sourceSystem": "sqlite-legacy",
                "sourceId": str(line["id"]),
            })
        for idx, payment in enumerate(payment_rows):
            method_label = payment.get("method")
            method = method_label or "Outro"
            if method not in {"Dinheiro", "Débito", "Crédito", "Pix"}:
                method = "Outro"
                method_label = method_label or None
            else:
                method_label = None
            sale_payments.append({
                "paymentId": f"legacy-payment-{payment.get('id', sale_id)}", "saleId": sale_id,
                "method": method, "methodLabel": method_label if method == "Outro" else None,
                "amountCents": int(payment["amount_cents"]),
                "feeRate": str(payment.get("fee_rate", 0)), "feeCents": fee_parts[idx],
                "sourceSystem": "sqlite-legacy", "sourceId": str(payment.get("id", f"{sale_id}-{idx}")),
            })

    for group_id, group in groups.items():
        lines = grouped_entries.pop(group_id, [])
        if not lines:
            errors.append(f"sale_groups.group_id={group_id}: venda sem itens no ledger")
            continue
        add_sale(group_id, group, lines, payments_by_group.get(group_id, []), f"sale_groups.group_id={group_id}")
    for group_id, lines in grouped_entries.items():
        errors.append(f"entries [sale_group:{group_id}]: venda sem cabeçalho")

    for entry in loose_entries:
        amount = int(entry["amount_cents"])
        source_method = entry.get("payment_method")
        if source_method == "Misto":
            errors.append(f"entries.id={entry['id']}: pagamento Misto sem sale_group não pode ser conciliado")
        method = source_method if source_method in rate_by_method else "Outro"
        pseudo = {"id": entry["id"], "method": source_method or "Outro", "amount_cents": amount,
                  "fee_rate": str(rate_by_method[method])}
        add_sale(f"legacy-entry-{entry['id']}", None, [entry], [pseudo], f"entries.id={entry['id']}")

    for entry in entries:
        if entry["kind"] == "Venda":
            continue
        ledger_id = f"legacy-entry:{entry['id']}"
        entry_type = "purchase" if entry["kind"] == "Compra" else "expense"
        ledger_entries.append(make_ledger(
            ledger_id=ledger_id, key=f"sqlite:entry:{entry['id']}", entry_type=entry_type,
            entry_date=entry["entry_date"], created_at=entry["created_at"], amount=int(entry["amount_cents"]),
            description=entry["description"], category=entry["category"],
            counterparty=entry.get("supplier_or_customer"), notes=entry.get("notes"), source_id=str(entry["id"])))
        if entry_type == "purchase":
            purchase_id = f"legacy-purchase-{entry['id']}"
            purchases.append({"purchaseId": purchase_id, "ledgerId": ledger_id,
                              "supplier": entry.get("supplier_or_customer"), "paymentMethod": entry.get("payment_method"),
                              "totalCents": int(entry["amount_cents"]), "notes": entry.get("notes"),
                              "createdAt": ledger_entries[-1]["occurredAt"] or captured_at})
            purchase_items.append({"itemId": f"legacy-purchase-item-{entry['id']}", "purchaseId": purchase_id,
                                   "descriptionSnapshot": entry["description"], "quantity": entry.get("quantity"),
                                   "unitPriceCents": entry.get("unit_price_cents"),
                                   "lineTotalCents": int(entry["amount_cents"]), "sourceSystem": "sqlite-legacy",
                                   "sourceId": str(entry["id"])})
        else:
            expenses.append({"expenseId": f"legacy-expense-{entry['id']}", "ledgerId": ledger_id,
                             "category": entry["category"], "description": entry["description"],
                             "paymentMethod": entry.get("payment_method"), "amountCents": int(entry["amount_cents"]),
                             "notes": entry.get("notes"), "createdAt": ledger_entries[-1]["occurredAt"] or captured_at})

    return {"ledgerEntries": ledger_entries, "sales": sales, "saleItems": sale_items,
            "salePayments": sale_payments, "purchases": purchases, "purchaseItems": purchase_items,
            "expenses": expenses}


def build_import_bundle(sqlite_path: str | Path, workbook_path: str | Path) -> dict:
    """Build an immutable, validated D1 import payload without changing either source."""
    sqlite_path, workbook_path = Path(sqlite_path), Path(workbook_path)
    if not sqlite_path.is_file():
        raise MigrationValidationError([f"SQLite não encontrado: {sqlite_path}"])
    if not workbook_path.is_file():
        raise MigrationValidationError([f"Workbook não encontrado: {workbook_path}"])
    workbook_fingerprint = _source_fingerprint(workbook_path)
    captured_at = _utc_now()
    errors: list[str] = []
    workbook_config, workbook_counts, workbook_errors = _read_workbook(workbook_path, captured_at)
    errors.extend(workbook_errors)
    with _validated_sqlite_snapshot(sqlite_path) as (snapshot_path, sqlite_fingerprint):
        db = sqlite3.connect(f"file:{snapshot_path.resolve().as_posix()}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            db.execute("BEGIN")
            sqlite_config, sqlite_counts = _sqlite_config(db, captured_at, errors)
            config = _merge_config(workbook_config, sqlite_config)
            history = _financial_history(db, captured_at, errors)
            source_financial_counts = {}
            for kind in ("Venda", "Compra", "Gasto"):
                row = db.execute(
                    "SELECT COUNT(*), COALESCE(SUM(amount_cents), 0) FROM entries WHERE kind=?",
                    (kind,),
                ).fetchone()
                source_financial_counts[kind] = (int(row[0]), int(row[1]))
        finally:
            db.close()
    tables = {**config, **history}
    row_counts = {name: len(rows) for name, rows in tables.items()}
    expected = {**workbook_counts, **sqlite_counts}
    reconciliation = {
        "workbook": workbook_counts,
        "sqlite": sqlite_counts,
        "merged": {name: len(tables.get(name, [])) for name in expected},
        "ledger": {name: len(tables[name]) for name in history},
        "source_policy": "Workbook configuration is imported first; matching SQLite records override it.",
        "source_differences": [],
    }
    for key in ("ingredients", "recipes", "recipeLines"):
        if workbook_counts.get(key) != sqlite_counts.get(key):
            reconciliation["source_differences"].append({
                "table": key, "workbook": workbook_counts.get(key, 0), "sqlite": sqlite_counts.get(key, 0),
                "merged": len(tables.get(key, [])),
            })
    financial_reconciliation = {}
    for kind in ("Venda", "Compra", "Gasto"):
        source_count, source_total = source_financial_counts[kind]
        mapped_type = {"Venda": "sale", "Compra": "purchase", "Gasto": "expense"}[kind]
        mapped_total = sum(int(row["amountCents"]) for row in history["ledgerEntries"] if row["entryType"] == mapped_type)
        mapped_count = {"Venda": len(history["saleItems"]), "Compra": len(history["purchaseItems"]),
                        "Gasto": len(history["expenses"])}[kind]
        matches = source_total == mapped_total and source_count == mapped_count
        financial_reconciliation[kind] = {"source_entries": source_count, "mapped_records": mapped_count,
                                          "source_cents": source_total, "mapped_cents": mapped_total,
                                          "matches": matches}
        if not matches:
            errors.append(f"Reconciliação {kind}: origem={source_count} lançamentos/{source_total}¢, "
                          f"migração={mapped_count} registros/{mapped_total}¢")
    reconciliation["financial"] = financial_reconciliation
    if errors:
        raise MigrationValidationError(errors, {"reconciliation": reconciliation})

    source_bytes = json.dumps(tables, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    workbook_digest = hashlib.sha256(workbook_path.read_bytes()).hexdigest()
    stable_tables = json.loads(source_bytes)
    for rows in stable_tables.values():
        for row in rows:
            for volatile in ("createdAt", "updatedAt", "recordedAt"):
                row.pop(volatile, None)
    stable_bytes = json.dumps(stable_tables, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    source_digest = hashlib.sha256(stable_bytes + workbook_digest.encode()).hexdigest()
    import_id = hashlib.sha256(f"{CONTRACT}:{CONTRACT_VERSION}:{source_digest}".encode()).hexdigest()
    for ledger_entry in history["ledgerEntries"]:
        ledger_entry["importId"] = import_id
    workbook_changed = workbook_fingerprint != _source_fingerprint(workbook_path)
    if workbook_changed:
        raise MigrationValidationError(["Planilha de origem foi alterada durante a geração; nenhum pacote foi produzido."])
    reconciliation["financial"] = financial_reconciliation
    return {
        "contract": CONTRACT,
        "contract_version": CONTRACT_VERSION,
        "import_id": import_id,
        "source": {"sqlite_name": sqlite_path.name, "workbook_name": workbook_path.name,
                   "workbook_sha256": workbook_digest, "sqlite_data_sha256": hashlib.sha256(stable_bytes).hexdigest(),
                   "sqlite_file_sha256": sqlite_fingerprint["sha256"],
                   "source_digest": source_digest, "timezone": "America/Sao_Paulo", "captured_at": captured_at},
        "provenance": {
            "timezone": "America/Sao_Paulo",
            "captured_at": captured_at,
            "source_files": {"sqlite": sqlite_fingerprint, "workbook": workbook_fingerprint},
            "totals": {name: {"source_cents": line["source_cents"], "mapped_cents": line["mapped_cents"], "matches": line["matches"]} for name, line in financial_reconciliation.items()},
        },
        "row_counts": row_counts,
        "reconciliation": reconciliation,
        "tables": tables,
    }


def write_import_bundle(bundle: dict, destination: str | Path) -> Path:
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(bundle, ensure_ascii=False, indent=2) + "\n"
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as temporary:
            temp_path = Path(temporary.name)
            temporary.write(payload)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()
    return path


def compare_import_bundles(current: dict, previous: dict) -> dict:
    """Summarize normalized row and financial total changes between bundles."""
    current_tables = current.get("tables", {})
    previous_tables = previous.get("tables", {})
    table_names = sorted(set(current_tables) | set(previous_tables))
    return {
        "previous_import_id": previous.get("import_id"),
        "current_import_id": current.get("import_id"),
        "same_import": previous.get("import_id") == current.get("import_id"),
        "tables": {name: {"before": len(previous_tables.get(name, [])), "after": len(current_tables.get(name, [])), "delta": len(current_tables.get(name, [])) - len(previous_tables.get(name, []))} for name in table_names},
        "financial": {
            kind: {
                metric: {
                    "before": previous.get("reconciliation", {}).get("financial", {}).get(kind, {}).get(metric, 0),
                    "after": current.get("reconciliation", {}).get("financial", {}).get(kind, {}).get(metric, 0),
                    "delta": current.get("reconciliation", {}).get("financial", {}).get(kind, {}).get(metric, 0)
                    - previous.get("reconciliation", {}).get("financial", {}).get(kind, {}).get(metric, 0),
                }
                for metric in ("source_cents", "mapped_cents")
            }
            for kind in sorted(set(previous.get("reconciliation", {}).get("financial", {})) | set(current.get("reconciliation", {}).get("financial", {})))
        },
    }
