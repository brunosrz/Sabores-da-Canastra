"""SQLite local para lançamentos pós-venda e pós-compra."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
import sqlite3
import uuid
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
    unit_cost_cents: int | None = None


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
            columns={row[1] for row in db.execute("PRAGMA table_info(entries)")}
            if "unit_cost_cents" not in columns:db.execute("ALTER TABLE entries ADD COLUMN unit_cost_cents INTEGER")
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
            db.execute("""
                CREATE TABLE IF NOT EXISTS products (
                    product_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                    category TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'un',
                    sale_price_cents INTEGER, unit_cost_cents INTEGER, barcode TEXT, auxiliary_code TEXT,
                    active INTEGER NOT NULL DEFAULT 1,
                    notes TEXT
                )
            """)
            product_columns={row[1] for row in db.execute("PRAGMA table_info(products)")}
            if "unit_cost_cents" not in product_columns:db.execute("ALTER TABLE products ADD COLUMN unit_cost_cents INTEGER")
            if "barcode" not in product_columns:db.execute("ALTER TABLE products ADD COLUMN barcode TEXT")
            if "auxiliary_code" not in product_columns:db.execute("ALTER TABLE products ADD COLUMN auxiliary_code TEXT")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL AND barcode<>''")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_auxiliary_code ON products(auxiliary_code) WHERE auxiliary_code IS NOT NULL AND auxiliary_code<>''")
            db.execute("""CREATE TABLE IF NOT EXISTS sale_groups (
                group_id TEXT PRIMARY KEY,entry_date TEXT NOT NULL,total_cents INTEGER NOT NULL,created_at TEXT NOT NULL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS sale_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,group_id TEXT NOT NULL REFERENCES sale_groups(group_id) ON DELETE CASCADE,
                method TEXT NOT NULL,amount_cents INTEGER NOT NULL,fee_rate TEXT NOT NULL DEFAULT '0')""")
            db.execute("""CREATE TABLE IF NOT EXISTS parameters (
                name TEXT PRIMARY KEY,value TEXT NOT NULL,unit TEXT,status TEXT NOT NULL)""")

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
                  supplier_or_customer: str | None = None, notes: str | None = None,
                  unit_cost_cents: int | None = None) -> Entry:
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
                                    amount_cents,payment_method,supplier_or_customer,notes,created_at,unit_cost_cents)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """, (entry_date, kind, category.strip(), description.strip(), quantity,
                  unit_price_cents, amount_cents, payment_method,
                  (supplier_or_customer or "").strip() or None, (notes or "").strip() or None,
                  datetime.now().isoformat(timespec="seconds"),unit_cost_cents))
            row = db.execute("SELECT * FROM entries WHERE id=?", (cursor.lastrowid,)).fetchone()
            return self._row_to_entry(row)

    def product_unit_cost(self, product: dict) -> tuple[int | None,str]:
        if product.get("unit_cost_cents") is not None:return product["unit_cost_cents"],"Produto"
        recipes=[r for r in self.list_recipes() if r["product_name"]==product["name"]]
        if not recipes:return None,"Pendente"
        mix=self.list_mix()
        chosen=next((m for m in mix if m["product_name"]==product["name"] and m["quantity"]>0 and m["version"]==m["selected_version"]),None)
        if chosen:
            recipe=self.recipe(chosen["recipe_id"])
            if recipe:
                result=self.recipe_cost(recipe["recipe_id"])
                return result["unit_cost_cents"],"Ficha técnica" if result["unit_cost_cents"] is not None else "Pendente"
        for recipe in recipes:
            result=self.recipe_cost(recipe["recipe_id"])
            if result["unit_cost_cents"] is not None:return result["unit_cost_cents"],"Ficha técnica estimada"
        return None,"Pendente"

    def record_pos_sale(self, *, entry_date: str, items: list[dict], payments: list[dict],
                        customer: str | None = None, notes: str | None = None) -> dict:
        date.fromisoformat(entry_date)
        if not items:raise ValueError("Venda precisa conter pelo menos um item")
        total=sum(int(item["amount_cents"]) for item in items)
        active_payments=[p for p in payments if int(p.get("amount_cents",0))>0]
        if sum(int(p["amount_cents"]) for p in active_payments)!=total:
            raise ValueError("A soma de dinheiro, débito, crédito e Pix precisa ser igual ao total da venda")
        allowed={"Dinheiro","Débito","Crédito","Pix"}
        if any(p["method"] not in allowed or Decimal(str(p.get("fee_rate",0)))<0 for p in active_payments):
            raise ValueError("Forma de pagamento ou taxa inválida")
        group_id=uuid.uuid4().hex
        payment_method=active_payments[0]["method"] if len(active_payments)==1 else "Misto"
        fee=sum((Decimal(p["amount_cents"])*Decimal(str(p.get("fee_rate",0))) for p in active_payments),Decimal("0"))
        now=datetime.now().isoformat(timespec="seconds")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT INTO sale_groups(group_id,entry_date,total_cents,created_at) VALUES(?,?,?,?)",(group_id,entry_date,total,now))
            for item in items:
                db.execute("""INSERT INTO entries(entry_date,kind,category,description,quantity,unit_price_cents,amount_cents,
                    payment_method,supplier_or_customer,notes,created_at,unit_cost_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (entry_date,"Venda",item["category"],item["name"],str(item["quantity"]),int(item["unit_price_cents"]),
                     int(item["amount_cents"]),payment_method,customer or None,f"{notes or ''} [sale_group:{group_id}]".strip(),now,item.get("unit_cost_cents")))
            for payment in active_payments:
                db.execute("INSERT INTO sale_payments(group_id,method,amount_cents,fee_rate) VALUES(?,?,?,?)",
                           (group_id,payment["method"],int(payment["amount_cents"]),str(payment.get("fee_rate",0))))
        return {"group_id":group_id,"gross_cents":total,"fee_cents":int(fee.quantize(Decimal("1"),rounding=ROUND_HALF_UP)),
                "net_cents":total-int(fee.quantize(Decimal("1"),rounding=ROUND_HALF_UP))}

    def pos_report(self, start_date: str, end_date: str) -> dict:
        date.fromisoformat(start_date);date.fromisoformat(end_date)
        if start_date>end_date:raise ValueError("Data inicial deve ser anterior à final")
        with self._connect() as db:
            rows=db.execute("SELECT * FROM entries WHERE kind='Venda' AND entry_date BETWEEN ? AND ?",(start_date,end_date)).fetchall()
            payments=db.execute("""SELECT p.* FROM sale_payments p JOIN sale_groups g USING(group_id)
                WHERE g.entry_date BETWEEN ? AND ?""",(start_date,end_date)).fetchall()
            legacy=db.execute("""SELECT payment_method,amount_cents FROM entries WHERE kind='Venda'
                AND entry_date BETWEEN ? AND ? AND (notes IS NULL OR notes NOT LIKE '%[sale_group:%')""",(start_date,end_date)).fetchall()
            daily=db.execute("""SELECT entry_date,SUM(amount_cents) gross_cents FROM entries WHERE kind='Venda'
                AND entry_date BETWEEN ? AND ? GROUP BY entry_date ORDER BY entry_date""",(start_date,end_date)).fetchall()
            products=db.execute("""SELECT description,SUM(CAST(quantity AS REAL)) quantity,SUM(amount_cents) gross_cents,
                SUM(CASE WHEN unit_cost_cents IS NULL THEN 1 ELSE 0 END) missing_cost_lines,
                SUM(CASE WHEN unit_cost_cents IS NULL THEN 0 ELSE CAST(quantity AS REAL)*unit_cost_cents END) cost_cents
                FROM entries WHERE kind='Venda' AND entry_date BETWEEN ? AND ? GROUP BY description ORDER BY gross_cents DESC""",(start_date,end_date)).fetchall()
        gross=sum(int(row["amount_cents"]) for row in rows)
        known_cost=sum((Decimal(str(row["quantity"] or 0))*Decimal(row["unit_cost_cents"] or 0) for row in rows if row["unit_cost_cents"] is not None),Decimal("0"))
        missing=sum(1 for row in rows if row["unit_cost_cents"] is None)
        fee=sum((Decimal(row["amount_cents"])*Decimal(row["fee_rate"]) for row in payments),Decimal("0"))
        rates={"Dinheiro":Decimal("0"),"Pix":Decimal("0"),"Débito":Decimal(str(self.parameters().get("pos_debit_rate",{}).get("value","0.0139"))),
               "Crédito":Decimal(str(self.parameters().get("pos_credit_rate",{}).get("value","0.0334")))}
        for row in legacy:fee+=Decimal(row["amount_cents"])*rates.get(row["payment_method"],Decimal("0"))
        fee_cents=int(fee.quantize(Decimal("1"),rounding=ROUND_HALF_UP));cost_cents=int(known_cost.quantize(Decimal("1"),rounding=ROUND_HALF_UP))
        by_method={m:0 for m in ("Dinheiro","Débito","Crédito","Pix")}
        for p in payments:by_method[p["method"]]=by_method.get(p["method"],0)+int(p["amount_cents"])
        for row in legacy:
            if row["payment_method"] in by_method:by_method[row["payment_method"]]+=int(row["amount_cents"])
        return {"gross_cents":gross,"fees_cents":fee_cents,"net_cents":gross-fee_cents,
                "known_cost_cents":cost_cents,"profit_cents":gross-fee_cents-cost_cents,"missing_cost_lines":missing,
                "payments":by_method,"daily":[dict(row) for row in daily],"products":[dict(row) for row in products],
                "entries_count":len(rows)}

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
            row = db.execute("SELECT notes FROM entries WHERE id=?", (entry_id,)).fetchone()
            if not row:
                return False
            cursor = db.execute("DELETE FROM entries WHERE id=?", (entry_id,))
            if row["notes"]:
                marker = "[sale_group:"
                start = row["notes"].find(marker)
                if start >= 0:
                    group_id = row["notes"][start + len(marker):].split("]", 1)[0]
                    remaining = db.execute("SELECT COUNT(*) FROM entries WHERE notes LIKE ?", (f"%{marker}{group_id}]%",)).fetchone()[0]
                    if remaining == 0:
                        db.execute("DELETE FROM sale_groups WHERE group_id=?", (group_id,))
            return cursor.rowcount > 0

    def delete_ingredient(self, name: str) -> None:
        with self._connect() as db:
            used = db.execute("SELECT COUNT(*) FROM recipe_lines WHERE ingredient_name=?", (name,)).fetchone()[0]
            if used:
                raise ValueError(f"Ingrediente usado em {used} linha(s) de receita; remova ou substitua antes.")
            db.execute("DELETE FROM ingredients WHERE name=?", (name,))

    def delete_recipe(self, recipe_id: str) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM recipe_lines WHERE recipe_id=?", (recipe_id,))
            db.execute("DELETE FROM daily_mix WHERE recipe_id=?", (recipe_id,))
            db.execute("DELETE FROM recipes WHERE recipe_id=?", (recipe_id,))

    def upsert_product(self, *, product_id: str, name: str, category: str, unit: str = "un",
                       sale_price_cents: int | None = None, unit_cost_cents: int | None = None,
                       barcode: str | None = None, auxiliary_code: str | None = None,
                       active: bool = True, notes: str | None = None) -> None:
        if not product_id.strip() or not name.strip() or not category.strip():
            raise ValueError("ID, nome e categoria do produto são obrigatórios")
        if sale_price_cents is not None and sale_price_cents < 0:
            raise ValueError("Preço de venda não pode ser negativo")
        if unit_cost_cents is not None and unit_cost_cents < 0:raise ValueError("Custo unitário não pode ser negativo")
        barcode = (barcode or "").strip() or None
        auxiliary_code = (auxiliary_code or "").strip() or None
        with self._connect() as db:
            db.execute("""INSERT INTO products(product_id,name,category,unit,sale_price_cents,unit_cost_cents,barcode,auxiliary_code,active,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET name=excluded.name,
                category=excluded.category,unit=excluded.unit,sale_price_cents=excluded.sale_price_cents,
                unit_cost_cents=excluded.unit_cost_cents,barcode=excluded.barcode,auxiliary_code=excluded.auxiliary_code,
                active=excluded.active,notes=excluded.notes""",
                (product_id.strip(),name.strip(),category.strip(),unit,sale_price_cents,unit_cost_cents,barcode,auxiliary_code,int(active),notes))

    def list_products(self, active_only: bool = False) -> list[dict]:
        query="SELECT * FROM products" + (" WHERE active=1" if active_only else "") + " ORDER BY category,name"
        with self._connect() as db:
            return [dict(row) for row in db.execute(query)]

    def delete_product(self, product_id: str) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM products WHERE product_id=?",(product_id,))

    def replace_recipe(self, *, recipe_id: str, product_name: str, version: str, yield_units: int,
                       source: str | None, instructions: str | None,
                       lines: Iterable[tuple[str,str,str,str | None]]) -> None:
        if yield_units<=0 or not recipe_id.strip() or not product_name.strip():
            raise ValueError("ID, nome e rendimento positivo são obrigatórios")
        rows=list(lines)
        if not rows: raise ValueError("Adicione pelo menos um ingrediente à receita")
        with self._connect() as db:
            db.execute("""INSERT INTO recipes(recipe_id,product_name,version,yield_units,source,instructions)
                VALUES(?,?,?,?,?,?) ON CONFLICT(recipe_id) DO UPDATE SET product_name=excluded.product_name,
                version=excluded.version,yield_units=excluded.yield_units,source=excluded.source,instructions=excluded.instructions""",
                (recipe_id,product_name,version,yield_units,source,instructions))
            db.execute("DELETE FROM recipe_lines WHERE recipe_id=?",(recipe_id,))
            db.executemany("INSERT INTO recipe_lines(recipe_id,ingredient_name,quantity,unit,stage) VALUES(?,?,?,?,?)",
                           [(recipe_id,n,str(q),u,st) for n,q,u,st in rows])

    def replace_mix(self, rows: Iterable[tuple[str,int,str]]) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM daily_mix")
            db.executemany("INSERT INTO daily_mix(recipe_id,quantity,version) VALUES(?,?,?)",list(rows))

    def export_configuration(self) -> dict:
        """Export editable catalog/config only. The financial ledger is never part of this contract."""
        return {
            "schema": "sabores-da-canastra/config",
            "schema_version": 1,
            "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "preserve_ledger": True,
            "ingredients": self.list_ingredients(),
            "recipes": self.list_recipes(),
            "products": self.list_products(),
            "daily_mix": self.list_mix(),
            "parameters": self.parameters(),
        }

    def import_configuration(self, payload: dict) -> dict:
        """Validate whole document, then atomically upsert config without touching entries."""
        if payload.get("schema")!="sabores-da-canastra/config" or payload.get("schema_version")!=1:
            raise ValueError("Formato/schema incompatível; esperado sabores-da-canastra/config versão 1")
        if payload.get("preserve_ledger") is not True:
            raise ValueError("Contrato exige preserve_ledger=true; importação nunca altera o ledger")
        ingredients=payload.get("ingredients",[]);recipes=payload.get("recipes",[])
        products=payload.get("products",[]);mix=payload.get("daily_mix",[]);params=payload.get("parameters",{})
        if not all(isinstance(x,list) for x in (ingredients,recipes,products,mix)) or not isinstance(params,dict):
            raise ValueError("ingredients, recipes, products, daily_mix precisam ser listas e parameters um objeto")
        ingredient_names={}
        for item in ingredients:
            if not isinstance(item,dict) or not item.get("name") or not item.get("base_unit") or Decimal(str(item.get("pack_quantity",0)))<=0:
                raise ValueError("Ingrediente inválido: name, base_unit e pack_quantity positivo são obrigatórios")
            ingredient_names[item["name"]]=item["base_unit"]
        recipe_ids=set()
        for recipe in recipes:
            if not isinstance(recipe,dict) or not recipe.get("recipe_id") or not recipe.get("product_name") or int(recipe.get("yield_units",0))<=0:
                raise ValueError("Receita inválida: recipe_id, product_name e yield_units positivo são obrigatórios")
            recipe_ids.add(recipe["recipe_id"])
            if not isinstance(recipe.get("lines"),list) or not recipe["lines"]:
                raise ValueError(f"Receita {recipe['recipe_id']} precisa de pelo menos uma linha")
            for line in recipe["lines"]:
                if line.get("ingredient_name") not in ingredient_names:
                    raise ValueError(f"Ingrediente {line.get('ingredient_name')} não está no catálogo")
                if line.get("unit")!=ingredient_names[line["ingredient_name"]]:
                    raise ValueError(f"Unidade incompatível para {line['ingredient_name']}: use {ingredient_names[line['ingredient_name']]}")
                if Decimal(str(line.get("quantity",-1)))<0 or not line.get("unit"):
                    raise ValueError(f"Linha inválida em {recipe['recipe_id']}")
        for product in products:
            if not isinstance(product,dict) or not product.get("product_id") or not product.get("name") or not product.get("category"):
                raise ValueError("Produto precisa de product_id, name e category")
            for field in ("barcode", "auxiliary_code"):
                if product.get(field) is not None and not isinstance(product[field],str):
                    raise ValueError(f"{field} precisa ser texto ou null")
        for item in mix:
            if item.get("recipe_id") not in recipe_ids or int(item.get("quantity",-1))<0 or item.get("selected_version","E") not in {"E","R"}:
                raise ValueError("Linha de mix inválida")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for item in ingredients:
                db.execute("""INSERT INTO ingredients(name,base_unit,pack_quantity,pack_price_cents,supplier,price_date,price_status,source,notes)
                    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET base_unit=excluded.base_unit,
                    pack_quantity=excluded.pack_quantity,pack_price_cents=excluded.pack_price_cents,supplier=excluded.supplier,
                    price_date=excluded.price_date,price_status=excluded.price_status,source=excluded.source,notes=excluded.notes""",
                    (item["name"],item["base_unit"],str(item["pack_quantity"]),item.get("pack_price_cents"),item.get("supplier"),
                     item.get("price_date"),item.get("price_status","Pendente"),item.get("source"),item.get("notes")))
            for recipe in recipes:
                db.execute("""INSERT INTO recipes(recipe_id,product_name,version,yield_units,source,instructions) VALUES(?,?,?,?,?,?)
                    ON CONFLICT(recipe_id) DO UPDATE SET product_name=excluded.product_name,version=excluded.version,
                    yield_units=excluded.yield_units,source=excluded.source,instructions=excluded.instructions""",
                    (recipe["recipe_id"],recipe["product_name"],recipe.get("version","E"),int(recipe["yield_units"]),recipe.get("source"),recipe.get("instructions")))
                db.execute("DELETE FROM recipe_lines WHERE recipe_id=?",(recipe["recipe_id"],))
                db.executemany("INSERT INTO recipe_lines(recipe_id,ingredient_name,quantity,unit,stage) VALUES(?,?,?,?,?)",
                    [(recipe["recipe_id"],line["ingredient_name"],str(line["quantity"]),line["unit"],line.get("stage")) for line in recipe["lines"]])
            for product in products:
                db.execute("""INSERT INTO products(product_id,name,category,unit,sale_price_cents,unit_cost_cents,barcode,auxiliary_code,active,notes) VALUES(?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(product_id) DO UPDATE SET name=excluded.name,category=excluded.category,unit=excluded.unit,
                    sale_price_cents=excluded.sale_price_cents,unit_cost_cents=excluded.unit_cost_cents,
                    barcode=excluded.barcode,auxiliary_code=excluded.auxiliary_code,
                    active=excluded.active,notes=excluded.notes""",
                    (product["product_id"],product["name"],product["category"],product.get("unit","un"),product.get("sale_price_cents"),product.get("unit_cost_cents"),product.get("barcode"),product.get("auxiliary_code"),int(product.get("active",True)),product.get("notes")))
            for key,value in params.items():
                db.execute("""INSERT INTO parameters(name,value,unit,status) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET
                    value=excluded.value,unit=excluded.unit,status=excluded.status""",
                    (key,str(value.get("value","")),value.get("unit",""),value.get("status","Estimado")))
            db.executemany("""INSERT INTO daily_mix(recipe_id,quantity,version) VALUES(?,?,?)
                ON CONFLICT(recipe_id) DO UPDATE SET quantity=excluded.quantity,version=excluded.version""",
                [(item["recipe_id"],int(item["quantity"]),item.get("selected_version","E")) for item in mix])
        return {"ingredients":len(ingredients),"recipes":len(recipes),"products":len(products),"ledger_preserved":True}

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
