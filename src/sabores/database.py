"""SQLite local para lançamentos pós-venda e pós-compra."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
import sqlite3
from typing import Iterable
from decimal import Decimal, ROUND_HALF_UP


@dataclass(frozen=True)
class Entry:
    id: int
    entry_date: str
    kind: str
    category: str
    description: str
    quantity: str | None
    unit_price_cents: int | None
    amount_cents: int
    payment_method: str | None
    supplier_or_customer: str | None
    notes: str | None
    created_at: str


class Ledger:
    """Small append-only ledger for daily sales, purchases and expenses."""

    KINDS = {"Venda", "Compra", "Gasto"}

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""
                CREATE TABLE IF NOT EXISTS entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entry_date TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK(kind IN ('Venda','Compra','Gasto')),
                    category TEXT NOT NULL,
                    description TEXT NOT NULL,
                    quantity TEXT,
                    unit_price_cents INTEGER,
                    amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
                    payment_method TEXT,
                    supplier_or_customer TEXT,
                    notes TEXT,
                    created_at TEXT NOT NULL
                )
            """)
            db.execute("CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_entries_kind_date ON entries(kind, entry_date)")
            db.execute("""
                CREATE TABLE IF NOT EXISTS ingredients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
                    base_unit TEXT NOT NULL, pack_quantity TEXT NOT NULL,
                    pack_price_cents INTEGER, supplier TEXT, price_date TEXT,
                    price_status TEXT NOT NULL DEFAULT 'Pendente', source TEXT, notes TEXT
                )
            """)
            db.execute("""
                CREATE TABLE IF NOT EXISTS recipes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id TEXT NOT NULL UNIQUE,
                    product_name TEXT NOT NULL, version TEXT NOT NULL,
                    yield_units INTEGER NOT NULL, source TEXT, instructions TEXT
                )
            """)
            db.execute("""
                CREATE TABLE IF NOT EXISTS recipe_lines (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recipe_id TEXT NOT NULL REFERENCES recipes(recipe_id) ON DELETE CASCADE,
                    ingredient_name TEXT NOT NULL,
                    quantity TEXT NOT NULL,
                    unit TEXT NOT NULL,
                    stage TEXT
                )
            """)
            db.execute("""
                CREATE TABLE IF NOT EXISTS daily_mix (
                    recipe_id TEXT PRIMARY KEY REFERENCES recipes(recipe_id),
                    quantity INTEGER NOT NULL DEFAULT 0,
                    version TEXT NOT NULL DEFAULT 'E'
                )
            """)

    def upsert_ingredient(self, *, name: str, base_unit: str, pack_quantity: str,
                          pack_price_cents: int | None = None, supplier: str | None = None,
                          price_date: str | None = None, price_status: str = "Pendente",
                          source: str | None = None, notes: str | None = None) -> None:
        if not name.strip() or not base_unit.strip() or float(pack_quantity) <= 0:
            raise ValueError("Nome, unidade e quantidade positiva de embalagem são obrigatórios")
        if pack_price_cents is not None and pack_price_cents < 0:
            raise ValueError("Preço de embalagem não pode ser negativo")
        if price_date:
            date.fromisoformat(price_date)
        if price_status not in {"Confirmado", "Estimado", "Desatualizado", "Pendente"}:
            raise ValueError("Status de preço inválido")
        with self._connect() as db:
            db.execute("""
                INSERT INTO ingredients(name,base_unit,pack_quantity,pack_price_cents,supplier,price_date,price_status,source,notes)
                VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET
                base_unit=excluded.base_unit,pack_quantity=excluded.pack_quantity,
                pack_price_cents=excluded.pack_price_cents,supplier=excluded.supplier,
                price_date=excluded.price_date,price_status=excluded.price_status,
                source=excluded.source,notes=excluded.notes
            """, (name.strip(), base_unit.strip(), pack_quantity, pack_price_cents, supplier,
                  price_date, price_status, source, notes))

    def update_ingredient_price(self, name: str, *, pack_price_cents: int,
                                supplier: str | None, price_date: str,
                                price_status: str, source: str | None = None) -> None:
        date.fromisoformat(price_date)
        if pack_price_cents < 0 or price_status not in {"Confirmado", "Estimado", "Desatualizado", "Pendente"}:
            raise ValueError("Preço ou status inválido")
        with self._connect() as db:
            cur = db.execute("UPDATE ingredients SET pack_price_cents=?,supplier=?,price_date=?,price_status=?,source=? WHERE name=?",
                             (pack_price_cents, supplier, price_date, price_status, source, name))
            if cur.rowcount == 0:
                raise KeyError(name)

    def update_recipe_line(self, recipe_id: str, ingredient_name: str,
                           quantity: str, stage: str = "") -> None:
        if Decimal(quantity) < 0:
            raise ValueError("Quantidade não pode ser negativa")
        with self._connect() as db:
            cur = db.execute("UPDATE recipe_lines SET quantity=?,stage=? WHERE recipe_id=? AND ingredient_name=?",
                             (quantity, stage, recipe_id, ingredient_name))
            if cur.rowcount == 0:
                raise KeyError(f"{recipe_id}/{ingredient_name}")

    def adjust_recipe_yield(self, recipe_id: str, yield_units: int) -> None:
        if yield_units <= 0:
            raise ValueError("Rendimento deve ser positivo")
        with self._connect() as db:
            cur = db.execute("UPDATE recipes SET yield_units=? WHERE recipe_id=?", (yield_units, recipe_id))
            if cur.rowcount == 0:
                raise KeyError(recipe_id)

    def list_ingredients(self) -> list[dict]:
        with self._connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM ingredients ORDER BY name")]

    def upsert_recipe(self, *, recipe_id: str, product_name: str, version: str,
                      yield_units: int, source: str | None = None,
                      instructions: str | None = None,
                      lines: Iterable[tuple[str, str, str, str | None]] = ()) -> None:
        if not recipe_id.strip() or not product_name.strip() or yield_units <= 0:
            raise ValueError("Receita requer ID, nome e rendimento positivo")
        with self._connect() as db:
            db.execute("""
                INSERT INTO recipes(recipe_id,product_name,version,yield_units,source,instructions)
                VALUES(?,?,?,?,?,?) ON CONFLICT(recipe_id) DO UPDATE SET
                product_name=excluded.product_name,version=excluded.version,yield_units=excluded.yield_units,
                source=excluded.source,instructions=excluded.instructions
            """, (recipe_id, product_name, version, yield_units, source, instructions))
            db.execute("DELETE FROM recipe_lines WHERE recipe_id=?", (recipe_id,))
            db.executemany("INSERT INTO recipe_lines(recipe_id,ingredient_name,quantity,unit,stage) VALUES(?,?,?,?,?)",
                           [(recipe_id, name, str(quantity), unit, stage) for name, quantity, unit, stage in lines])

    def list_recipes(self) -> list[dict]:
        with self._connect() as db:
            recipes = [dict(row) for row in db.execute("SELECT * FROM recipes ORDER BY product_name,version")]
            for recipe in recipes:
                recipe["lines"] = [dict(row) for row in db.execute(
                    "SELECT ingredient_name,quantity,unit,stage FROM recipe_lines WHERE recipe_id=? ORDER BY id",
                    (recipe["recipe_id"],))]
            return recipes

    def recipe(self, recipe_id: str) -> dict | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM recipes WHERE recipe_id=?", (recipe_id,)).fetchone()
            if not row:
                return None
            result = dict(row)
            result["lines"] = [dict(line) for line in db.execute(
                "SELECT ingredient_name,quantity,unit,stage FROM recipe_lines WHERE recipe_id=? ORDER BY id",
                (recipe_id,))]
            return result

    def recipe_cost(self, recipe_id: str) -> dict:
        with self._connect() as db:
            recipe = db.execute("SELECT * FROM recipes WHERE recipe_id=?", (recipe_id,)).fetchone()
            if not recipe:
                raise KeyError(recipe_id)
            rows = db.execute("""
                SELECT rl.ingredient_name,rl.quantity,rl.unit,i.base_unit,i.pack_quantity,i.pack_price_cents,i.price_status
                FROM recipe_lines rl LEFT JOIN ingredients i ON i.name=rl.ingredient_name
                WHERE rl.recipe_id=? ORDER BY rl.id
            """, (recipe_id,)).fetchall()
        cost = Decimal("0")
        pending: list[str] = []
        details = []
        for row in rows:
            if row["pack_price_cents"] is None or not row["pack_quantity"] or row["unit"] != row["base_unit"]:
                pending.append(row["ingredient_name"])
                details.append({**dict(row), "cost_cents": None})
                continue
            if row["price_status"] in {"Pendente", "Desatualizado"} and row["pack_price_cents"] is None:
                pending.append(row["ingredient_name"])
                details.append({**dict(row), "cost_cents": None})
                continue
            line_cost = (Decimal(row["quantity"]) / Decimal(row["pack_quantity"]) * Decimal(row["pack_price_cents"]))
            cost += line_cost
            details.append({**dict(row), "cost_cents": int(line_cost.quantize(Decimal("1"), rounding=ROUND_HALF_UP))})
        return {"recipe": dict(recipe), "batch_cost_cents": int(cost.quantize(Decimal("1"), rounding=ROUND_HALF_UP)) if not pending else None,
                "unit_cost_cents": int((cost / recipe["yield_units"]).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) if not pending else None,
                "pending_ingredients": pending, "lines": details}

    def set_mix(self, recipe_id: str, quantity: int, version: str) -> None:
        if quantity < 0 or version not in {"E", "R"}:
            raise ValueError("Quantidade deve ser não negativa e versão E ou R")
        with self._connect() as db:
            db.execute("INSERT INTO daily_mix(recipe_id,quantity,version) VALUES(?,?,?) "
                       "ON CONFLICT(recipe_id) DO UPDATE SET quantity=excluded.quantity,version=excluded.version",
                       (recipe_id, quantity, version))

    def list_mix(self) -> list[dict]:
        with self._connect() as db:
            return [dict(row) for row in db.execute("""
                SELECT r.recipe_id,r.product_name,r.version,r.yield_units,
                       COALESCE(m.quantity,0) AS quantity,COALESCE(m.version,'E') AS selected_version
                FROM recipes r LEFT JOIN daily_mix m USING(recipe_id)
                ORDER BY r.product_name,r.version
            """)]

    def upsert_parameter(self, name: str, value: str, unit: str = "", status: str = "Estimado") -> None:
        with self._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS parameters (name TEXT PRIMARY KEY,value TEXT NOT NULL,unit TEXT,status TEXT NOT NULL)")
            db.execute("INSERT INTO parameters(name,value,unit,status) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,unit=excluded.unit,status=excluded.status",
                       (name,value,unit,status))

    def parameters(self) -> dict[str, dict[str, str]]:
        with self._connect() as db:
            return {row["name"]: {"value":row["value"],"unit":row["unit"],"status":row["status"]}
                    for row in db.execute("SELECT * FROM parameters")}

    def shopping_list(self) -> list[dict]:
        totals: dict[str, dict] = {}
        for mix in self.list_mix():
            if not mix["quantity"] or mix["version"] != mix["selected_version"]:
                continue
            rid = mix["recipe_id"].rsplit("_", 1)[0] + "_" + mix["selected_version"]
            recipe = self.recipe(rid)
            if not recipe:
                continue
            batches = (mix["quantity"] + recipe["yield_units"] - 1) // recipe["yield_units"]
            for line in recipe["lines"]:
                item = totals.setdefault(line["ingredient_name"], {"unit":line["unit"],"quantity":Decimal("0")})
                item["quantity"] += Decimal(line["quantity"]) * batches
        ingredients = {i["name"]:i for i in self.list_ingredients()}
        result=[]
        for name, item in sorted(totals.items()):
            ingredient=ingredients.get(name)
            result.append({"name":name,"unit":item["unit"],"quantity":item["quantity"],
                           "package_quantity":Decimal(ingredient["pack_quantity"]) if ingredient else None,
                           "packages":int((item["quantity"]/Decimal(ingredient["pack_quantity"])).to_integral_value(rounding=ROUND_HALF_UP)) if ingredient and Decimal(ingredient["pack_quantity"]) else None,
                           "price_cents":ingredient["pack_price_cents"] if ingredient else None,
                           "status":ingredient["price_status"] if ingredient else "Pendente"})
            if result[-1]["packages"] is not None:
                result[-1]["packages"] = int((item["quantity"]/Decimal(ingredient["pack_quantity"])).to_integral_value(rounding="ROUND_CEILING"))
        return result

    @staticmethod
    def _row_to_entry(row: sqlite3.Row) -> Entry:
        return Entry(**dict(row))

    def add_entry(self, *, entry_date: str, kind: str, category: str, description: str,
                  amount_cents: int, quantity: str | None = None,
                  unit_price_cents: int | None = None, payment_method: str | None = None,
                  supplier_or_customer: str | None = None, notes: str | None = None) -> Entry:
        date.fromisoformat(entry_date)
        if kind not in self.KINDS:
            raise ValueError(f"Tipo inválido: {kind}")
        if not category.strip() or not description.strip():
            raise ValueError("Categoria e descrição são obrigatórias")
        if amount_cents <= 0:
            raise ValueError("O valor deve ser maior que zero")
        with self._connect() as db:
            cursor = db.execute("""
                INSERT INTO entries(entry_date,kind,category,description,quantity,unit_price_cents,
                                    amount_cents,payment_method,supplier_or_customer,notes,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """, (entry_date, kind, category.strip(), description.strip(), quantity,
                  unit_price_cents, amount_cents, payment_method,
                  (supplier_or_customer or "").strip() or None, (notes or "").strip() or None,
                  datetime.now().isoformat(timespec="seconds")))
            row = db.execute("SELECT * FROM entries WHERE id=?", (cursor.lastrowid,)).fetchone()
            return self._row_to_entry(row)

    def list_entries(self, *, start_date: str | None = None, end_date: str | None = None,
                     kind: str | None = None, limit: int = 1000) -> list[Entry]:
        clauses: list[str] = []
        values: list[object] = []
        if start_date:
            date.fromisoformat(start_date)
            clauses.append("entry_date>=?")
            values.append(start_date)
        if end_date:
            date.fromisoformat(end_date)
            clauses.append("entry_date<=?")
            values.append(end_date)
        if kind and kind != "Todos":
            if kind not in self.KINDS:
                raise ValueError(f"Tipo inválido: {kind}")
            clauses.append("kind=?")
            values.append(kind)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self._connect() as db:
            rows = db.execute(f"SELECT * FROM entries{where} ORDER BY entry_date DESC,id DESC LIMIT ?",
                              (*values, max(1, min(limit, 10000)))).fetchall()
        return [self._row_to_entry(row) for row in rows]

    def delete_entry(self, entry_id: int) -> bool:
        with self._connect() as db:
            cursor = db.execute("DELETE FROM entries WHERE id=?", (entry_id,))
            return cursor.rowcount > 0

    def daily_summary(self, entry_date: str) -> dict[str, int]:
        date.fromisoformat(entry_date)
        with self._connect() as db:
            rows = db.execute("""
                SELECT kind, COALESCE(SUM(amount_cents),0) AS total
                FROM entries WHERE entry_date=? GROUP BY kind
            """, (entry_date,)).fetchall()
        result = {kind: 0 for kind in self.KINDS}
        result.update({row["kind"]: row["total"] for row in rows})
        result["Resultado"] = result["Venda"] - result["Compra"] - result["Gasto"]
        return result

    def monthly_summary(self, year: int, month: int) -> dict[str, int]:
        if not 1 <= month <= 12:
            raise ValueError("Mês inválido")
        prefix = f"{year:04d}-{month:02d}"
        with self._connect() as db:
            rows = db.execute("""
                SELECT kind, COALESCE(SUM(amount_cents),0) AS total
                FROM entries WHERE entry_date LIKE ? GROUP BY kind
            """, (prefix + "%",)).fetchall()
        result = {kind: 0 for kind in self.KINDS}
        result.update({row["kind"]: row["total"] for row in rows})
        result["Resultado"] = result["Venda"] - result["Compra"] - result["Gasto"]
        return result

    def categories(self, kind: str | None = None) -> list[str]:
        with self._connect() as db:
            if kind and kind in self.KINDS:
                rows = db.execute("SELECT DISTINCT category FROM entries WHERE kind=? ORDER BY category", (kind,)).fetchall()
            else:
                rows = db.execute("SELECT DISTINCT category FROM entries ORDER BY category").fetchall()
        return [row[0] for row in rows]
