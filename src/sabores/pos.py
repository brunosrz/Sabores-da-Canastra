"""Ponto de venda desktop com relatórios de vendas, compartilhando o ledger SQLite."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk

from .database import Ledger
from .desktop import BG, GOLD, GREEN, INK, MUTED, PANEL, RED, format_money, parse_money


def _money_field(cents: int) -> str:
    return f"{Decimal(cents) / 100:.2f}".replace(".", ",")


def _month_shift(day: date, months: int) -> date:
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


class DatePicker(tk.Toplevel):
    def __init__(self, parent: tk.Misc, variable: tk.StringVar):
        super().__init__(parent)
        self.title("Escolher data")
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()
        self.variable = variable
        try:
            self.cursor = date.fromisoformat(variable.get())
        except ValueError:
            self.cursor = date.today()
        self.configure(bg=PANEL, padx=12, pady=12)
        self._draw()

    def _draw(self):
        for child in self.winfo_children():
            child.destroy()
        nav = tk.Frame(self, bg=PANEL)
        nav.pack(fill="x", pady=(0, 8))
        tk.Button(nav, text="‹", command=lambda: self._move(-1), relief="flat", bg="#E8EDE8").pack(side="left")
        tk.Label(nav, text=self.cursor.strftime("%B %Y"), bg=PANEL, fg=INK,
                 font=("Segoe UI", 11, "bold")).pack(side="left", expand=True, padx=14)
        tk.Button(nav, text="›", command=lambda: self._move(1), relief="flat", bg="#E8EDE8").pack(side="right")
        grid = tk.Frame(self, bg=PANEL)
        grid.pack()
        for col, label in enumerate(("S", "T", "Q", "Q", "S", "S", "D")):
            tk.Label(grid, text=label, width=4, bg=PANEL, fg=MUTED).grid(row=0, column=col)
        first = date(self.cursor.year, self.cursor.month, 1)
        offset = (first.weekday() + 1) % 7
        for day_number in range(1, monthrange(self.cursor.year, self.cursor.month)[1] + 1):
            index = offset + day_number - 1
            tk.Button(grid, text=str(day_number), width=3, relief="flat", bg="#E8EDE8" if day_number == self.cursor.day else PANEL,
                      command=lambda value=day_number: self._choose(value)).grid(row=1 + index // 7, column=index % 7, padx=1, pady=1)

    def _move(self, months: int):
        self.cursor = _month_shift(self.cursor, months)
        self._draw()

    def _choose(self, day_number: int):
        self.variable.set(date(self.cursor.year, self.cursor.month, day_number).isoformat())
        self.destroy()


class PosApp(tk.Tk):
    METHODS = ("Dinheiro", "Débito", "Crédito", "Pix")

    def __init__(self, db_path: str | Path | None = None):
        super().__init__()
        self.title("Sabores da Canastra | PDV")
        self.geometry("1420x900")
        self.minsize(1100, 720)
        self.ledger = Ledger(db_path or Path.home() / ".sabores-da-canastra" / "sabores.db")
        self._seed_menu_products()
        self.configure(bg=BG)
        self._configure_style()
        self.cart: list[dict] = []
        self.payment_vars = {method: tk.StringVar(value="0,00") for method in self.METHODS}
        self._build()
        self._refresh_products()
        self.update_preview()
        self.refresh_report()

    def _seed_menu_products(self):
        monsters = ("Original", "Mango Loco", "Ultra White", "Ultra Paradise", "Pipeline Punch")
        sodas = ("Coca-Cola", "Guaraná Antarctica", "Fanta Laranja", "Fanta Uva", "Sprite")
        existing = {p["product_id"] for p in self.ledger.list_products()}
        for flavor in monsters:
            product_id = "monster-473-" + "".join(c.lower() if c.isalnum() else "-" for c in flavor).strip("-")
            if product_id not in existing:
                self.ledger.upsert_product(product_id=product_id, name=f"Monster 473 ml — {flavor}", category="Bebidas",
                                           unit="473 ml", sale_price_cents=1200, notes="Cadastro inicial do PDV")
        for flavor in sodas:
            product_id = "refrigerante-350-" + "".join(c.lower() if c.isalnum() else "-" for c in flavor).strip("-")
            if product_id not in existing:
                self.ledger.upsert_product(product_id=product_id, name=f"Refrigerante 350 ml — {flavor}", category="Bebidas",
                                           unit="350 ml", sale_price_cents=600, notes="Cadastro inicial do PDV")

    def _configure_style(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("Treeview", background=PANEL, fieldbackground=PANEL, foreground=INK,
                        rowheight=30, borderwidth=0, font=("Segoe UI", 9))
        style.configure("Treeview.Heading", background="#E8EDE8", foreground=INK,
                        font=("Segoe UI Semibold", 9), relief="flat")
        style.map("Treeview", background=[("selected", "#DCEBE2")], foreground=[("selected", INK)])
        style.configure("TCombobox", padding=6)

    def _build(self):
        shell = tk.Frame(self, bg=BG, padx=26, pady=20)
        shell.pack(fill="both", expand=True)
        header = tk.Frame(shell, bg=BG)
        header.pack(fill="x", pady=(0, 14))
        tk.Label(header, text="SABORES DA CANASTRA  ·  FRENTE DE CAIXA", bg=BG, fg=GREEN,
                 font=("Segoe UI", 10, "bold")).pack(anchor="w")
        title = tk.Frame(header, bg=BG)
        title.pack(fill="x", pady=(4, 0))
        tk.Label(title, text="PDV de vendas", bg=BG, fg=INK, font=("Segoe UI", 24, "bold")).pack(side="left")
        tk.Label(title, text="CAIXA SEPARADO · MESMO HISTÓRICO SQLITE", bg=BG, fg=MUTED,
                 font=("Segoe UI", 9, "bold")).pack(side="right", pady=12)

        top = tk.Frame(shell, bg=BG)
        top.pack(fill="x", pady=(0, 14))
        self.metric_labels = {}
        for label, key, color in (("VENDA BRUTA", "gross", GREEN), ("TAXAS", "fees", GOLD),
                                  ("RECEBIDO LÍQUIDO", "net", INK), ("LUCRO ESTIMADO", "profit", RED)):
            card = tk.Frame(top, bg=PANEL, padx=15, pady=11, highlightbackground="#E5EAE5", highlightthickness=1)
            card.pack(side="left", fill="x", expand=True, padx=(0, 9))
            tk.Label(card, text=label, bg=PANEL, fg=MUTED, font=("Segoe UI", 8, "bold")).pack(anchor="w")
            value = tk.Label(card, text="R$ 0,00", bg=PANEL, fg=color, font=("Segoe UI", 18, "bold"))
            value.pack(anchor="w", pady=(4, 0))
            self.metric_labels[key] = value

        body = tk.Frame(shell, bg=BG)
        body.pack(fill="both", expand=True)
        self.tabs = ttk.Notebook(body)
        self.tabs.pack(fill="both", expand=True)
        sale_tab = tk.Frame(self.tabs, bg=BG, padx=14, pady=14)
        report_tab = tk.Frame(self.tabs, bg=BG, padx=14, pady=14)
        self.tabs.add(sale_tab, text="  Lançar venda  ")
        self.tabs.add(report_tab, text="  Período e comparação  ")
        self._build_sale_tab(sale_tab)
        self._build_report_tab(report_tab)

    def _build_sale_tab(self, parent):
        left = tk.Frame(parent, bg=PANEL, padx=16, pady=15, width=335, highlightbackground="#E5EAE5", highlightthickness=1)
        left.pack(side="left", fill="y", padx=(0, 14))
        left.pack_propagate(False)
        tk.Label(left, text="Adicionar ao pedido", bg=PANEL, fg=INK, font=("Segoe UI", 14, "bold")).pack(anchor="w", pady=(0, 12))
        self.sale_date = tk.StringVar(value=date.today().isoformat())
        self.product_var = tk.StringVar()
        self.search_var = tk.StringVar()
        self.quantity_var = tk.StringVar(value="1")
        self.price_var = tk.StringVar()
        self.customer_var = tk.StringVar()
        self.notes_var = tk.StringVar()
        self._field(left, "Data da venda", self._date_entry(left, self.sale_date))
        search_row = tk.Frame(left, bg=PANEL)
        search_row.pack(fill="x", pady=(0, 3))
        self.search_entry = ttk.Entry(search_row, textvariable=self.search_var)
        self.search_entry.pack(side="left", fill="x", expand=True, ipady=4)
        self.search_entry.bind("<Return>", self.open_search_results)
        tk.Button(search_row, text="Buscar", command=self.open_search_results, bg=GREEN, fg="white",
                  relief="flat", padx=9, pady=5).pack(side="left", padx=(6, 0))
        tk.Label(left, text="Digite o código de barras, código auxiliar ou nome e pressione Enter. Busca vazia lista todos.", bg=PANEL, fg=MUTED,
                 font=("Segoe UI", 8), wraplength=280, justify="left").pack(anchor="w", pady=(0, 9))
        self.selected_product_label = tk.Label(left, text="Nenhum produto selecionado", bg="#E8EDE8", fg=INK,
                 font=("Segoe UI", 9, "bold"), anchor="w", padx=9, pady=8, wraplength=280, justify="left")
        self.selected_product_label.pack(fill="x", pady=(0, 9))
        row = tk.Frame(left, bg=PANEL)
        row.pack(fill="x", pady=(0, 10))
        tk.Label(row, text="Quantidade", bg=PANEL, fg=MUTED, font=("Segoe UI", 9, "bold")).grid(row=0, column=0, sticky="w")
        tk.Label(row, text="Preço unitário", bg=PANEL, fg=MUTED, font=("Segoe UI", 9, "bold")).grid(row=0, column=1, sticky="w", padx=(10, 0))
        self.quantity_entry = ttk.Entry(row, textvariable=self.quantity_var, width=9)
        self.quantity_entry.grid(row=1, column=0, sticky="ew", pady=(4, 0))
        self.quantity_entry.bind("<Return>", self.add_item)
        ttk.Entry(row, textvariable=self.price_var, width=13).grid(row=1, column=1, sticky="ew", padx=(10, 0), pady=(4, 0))
        row.columnconfigure(1, weight=1)
        tk.Button(left, text="＋  Confirmar quantidade e adicionar", command=self.add_item, bg=GREEN, fg="white", relief="flat",
                  font=("Segoe UI", 10, "bold"), pady=8).pack(fill="x", pady=(0, 12))
        self._field(left, "Cliente (opcional)", ttk.Entry(left, textvariable=self.customer_var))
        self._field(left, "Observação (opcional)", ttk.Entry(left, textvariable=self.notes_var))
        tk.Label(left, text="Taxas da maquininha", bg=PANEL, fg=INK, font=("Segoe UI", 10, "bold")).pack(anchor="w", pady=(7, 5))
        params = self.ledger.parameters()
        self.debit_rate = tk.StringVar(value=str(Decimal(params.get("pos_debit_rate", {}).get("value", "0.0139")) * 100).replace(".", ","))
        self.credit_rate = tk.StringVar(value=str(Decimal(params.get("pos_credit_rate", {}).get("value", "0.0334")) * 100).replace(".", ","))
        fees = tk.Frame(left, bg=PANEL)
        fees.pack(fill="x")
        for col, (label, variable) in enumerate((("Débito %", self.debit_rate), ("Crédito %", self.credit_rate))):
            tk.Label(fees, text=label, bg=PANEL, fg=MUTED, font=("Segoe UI", 8, "bold")).grid(row=0, column=col, sticky="w")
            ttk.Entry(fees, textvariable=variable, width=12).grid(row=1, column=col, sticky="ew", padx=(0, 8), pady=(3, 5))
            variable.trace_add("write", lambda *_: self.update_preview())
        tk.Label(left, text="Percentuais salvos no SQLite e usados nos relatórios.", bg=PANEL, fg=MUTED,
                 font=("Segoe UI", 8), wraplength=280, justify="left").pack(anchor="w", pady=(2, 0))

        right = tk.Frame(parent, bg=BG)
        right.pack(side="left", fill="both", expand=True)
        cart_panel = tk.Frame(right, bg=PANEL, padx=14, pady=13, highlightbackground="#E5EAE5", highlightthickness=1)
        cart_panel.pack(fill="both", expand=True, pady=(0, 12))
        rowhead = tk.Frame(cart_panel, bg=PANEL)
        rowhead.pack(fill="x", pady=(0, 9))
        tk.Label(rowhead, text="Pedido", bg=PANEL, fg=INK, font=("Segoe UI", 14, "bold")).pack(side="left")
        tk.Button(rowhead, text="Remover selecionado", command=self.remove_item, bg="#F8E9E6", fg=RED, relief="flat", padx=8, pady=5).pack(side="right")
        self.cart_tree = ttk.Treeview(cart_panel, columns=("category", "quantity", "unit", "total"), show="headings", height=8)
        for col, label, width in (("category", "Item", 250), ("quantity", "Qtd.", 70), ("unit", "Unitário", 110), ("total", "Total", 110)):
            self.cart_tree.heading(col, text=label)
            self.cart_tree.column(col, width=width, anchor="w" if col == "category" else "e")
        self.cart_tree.pack(fill="both", expand=True)
        self.total_label = tk.Label(cart_panel, text="Total da venda  R$ 0,00", bg=PANEL, fg=INK, font=("Segoe UI", 15, "bold"))
        self.total_label.pack(anchor="e", pady=(10, 0))

        payment_panel = tk.Frame(right, bg=PANEL, padx=14, pady=12, highlightbackground="#E5EAE5", highlightthickness=1)
        payment_panel.pack(fill="x")
        tk.Label(payment_panel, text="Divisão do pagamento", bg=PANEL, fg=INK, font=("Segoe UI", 12, "bold")).pack(anchor="w", pady=(0, 8))
        row = tk.Frame(payment_panel, bg=PANEL)
        row.pack(fill="x")
        for method in self.METHODS:
            col = tk.Frame(row, bg=PANEL)
            col.pack(side="left", fill="x", expand=True, padx=(0, 8))
            tk.Label(col, text=method, bg=PANEL, fg=MUTED, font=("Segoe UI", 9, "bold")).pack(anchor="w")
            entry = ttk.Entry(col, textvariable=self.payment_vars[method])
            entry.pack(fill="x", pady=(3, 0))
            if method != "Pix":
                self.payment_vars[method].trace_add("write", lambda *_: self.update_preview())
        tk.Button(payment_panel, text="Completar restante com Pix", command=self.fill_pix, bg="#E8EDE8", fg=INK,
                  relief="flat", padx=9, pady=6).pack(anchor="e", pady=(7, 0))
        self.preview_label = tk.Label(payment_panel, text="Taxa estimada: R$ 0,00   ·   Líquido: R$ 0,00", bg=PANEL, fg=MUTED, font=("Segoe UI", 9, "bold"))
        self.preview_label.pack(anchor="w", pady=(5, 0))
        self.save_button = tk.Button(payment_panel, text="Registrar venda", command=self.save_sale, bg=GREEN, fg="white",
                                     relief="flat", font=("Segoe UI", 11, "bold"), padx=16, pady=10)
        self.save_button.pack(side="right", pady=(8, 0))
        self.payment_status = tk.Label(payment_panel, text="Informe a divisão para habilitar o lançamento.", bg=PANEL, fg=MUTED, font=("Segoe UI", 8))
        self.payment_status.pack(side="left", pady=(12, 0))

    def _build_report_tab(self, parent):
        filters = tk.Frame(parent, bg=PANEL, padx=14, pady=12, highlightbackground="#E5EAE5", highlightthickness=1)
        filters.pack(fill="x", pady=(0, 12))
        today = date.today()
        first_month = today.replace(day=1)
        self.report_start = tk.StringVar(value=first_month.isoformat())
        self.report_end = tk.StringVar(value=today.isoformat())
        tk.Label(filters, text="Período de vendas", bg=PANEL, fg=INK, font=("Segoe UI", 12, "bold")).pack(side="left", padx=(0, 16))
        self._date_control(filters, "De", self.report_start)
        self._date_control(filters, "Até", self.report_end)
        for label, callback in (("Hoje", self._range_today), ("Esta semana", self._range_week), ("Este mês", self._range_month)):
            tk.Button(filters, text=label, command=callback, bg="#E8EDE8", fg=INK, relief="flat", padx=8, pady=5).pack(side="left", padx=(8, 0), pady=5)
        tk.Button(filters, text="Atualizar", command=self.refresh_report, bg=GREEN, fg="white", relief="flat", padx=12, pady=6).pack(side="right", padx=(8, 0))
        content = tk.Frame(parent, bg=BG)
        content.pack(fill="both", expand=True)
        self.comparison_label = tk.Label(content, text="", bg=BG, fg=MUTED, font=("Segoe UI", 9, "bold"), anchor="w")
        self.comparison_label.pack(fill="x", pady=(0, 8))
        self.chart = tk.Canvas(content, height=145, bg=PANEL, highlightbackground="#E5EAE5", highlightthickness=1)
        self.chart.pack(fill="x", pady=(0, 12))
        tables = tk.Frame(content, bg=BG)
        tables.pack(fill="both", expand=True)
        daily_panel = tk.Frame(tables, bg=PANEL, padx=10, pady=10, highlightbackground="#E5EAE5", highlightthickness=1)
        daily_panel.pack(side="left", fill="both", expand=True, padx=(0, 10))
        product_panel = tk.Frame(tables, bg=PANEL, padx=10, pady=10, highlightbackground="#E5EAE5", highlightthickness=1)
        product_panel.pack(side="left", fill="both", expand=True)
        tk.Label(daily_panel, text="Dia a dia", bg=PANEL, fg=INK, font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=(0, 7))
        self.daily_tree = ttk.Treeview(daily_panel, columns=("date", "gross", "fees", "net"), show="headings", height=9)
        for col, label, width in (("date", "Data", 100), ("gross", "Bruto", 100), ("fees", "Taxas", 85), ("net", "Líquido", 100)):
            self.daily_tree.heading(col, text=label)
            self.daily_tree.column(col, width=width, anchor="e" if col != "date" else "w")
        self.daily_tree.pack(fill="both", expand=True)
        tk.Label(product_panel, text="Itens vendidos", bg=PANEL, fg=INK, font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=(0, 7))
        self.product_tree = ttk.Treeview(product_panel, columns=("name", "quantity", "gross", "cost"), show="headings", height=9)
        for col, label, width in (("name", "Produto", 190), ("quantity", "Qtd.", 60), ("gross", "Bruto", 100), ("cost", "Custo", 100)):
            self.product_tree.heading(col, text=label)
            self.product_tree.column(col, width=width, anchor="w" if col == "name" else "e")
        self.product_tree.pack(fill="both", expand=True)
        self.report_hint = tk.Label(content, text="", bg=BG, fg=MUTED, font=("Segoe UI", 8), anchor="w")
        self.report_hint.pack(fill="x", pady=(7, 0))

    def _field(self, parent, label, widget):
        tk.Label(parent, text=label, bg=PANEL, fg=MUTED, font=("Segoe UI", 9, "bold")).pack(anchor="w", pady=(0, 4))
        widget.pack(fill="x", pady=(0, 9), ipady=4) if isinstance(widget, ttk.Entry) else widget.pack(fill="x", pady=(0, 9))

    def _date_entry(self, parent, variable):
        frame = tk.Frame(parent, bg=PANEL)
        ttk.Entry(frame, textvariable=variable).pack(side="left", fill="x", expand=True)
        tk.Button(frame, text="▦", command=lambda: DatePicker(self, variable), bg="#E8EDE8", fg=INK, relief="flat", padx=8).pack(side="left", padx=(5, 0))
        return frame

    def _date_control(self, parent, label, variable):
        box = tk.Frame(parent, bg=PANEL)
        box.pack(side="left", padx=(0, 8))
        tk.Label(box, text=label, bg=PANEL, fg=MUTED, font=("Segoe UI", 8, "bold")).pack(anchor="w")
        self._date_entry(box, variable).pack(fill="x", pady=(3, 0))

    def _refresh_products(self):
        products = [p for p in self.ledger.list_products(active_only=True)
                    if p["sale_price_cents"] is not None and p["sale_price_cents"] > 0]
        self.products = products
        if self.product_var.get() not in {p["name"] for p in products}:
            self.product_var.set("")
            self.selected_product_label.configure(text="Nenhum produto selecionado")

    def open_search_results(self, _event=None):
        query = self.search_var.get().strip().casefold()
        matches = self.products if not query else [p for p in self.products if any(
            query in str(p.get(field) or "").casefold()
            for field in ("product_id", "barcode", "auxiliary_code", "name"))]
        if not matches:
            messagebox.showinfo("Produto não encontrado", f'Nenhum produto corresponde a "{self.search_var.get().strip()}".', parent=self)
            self.search_entry.focus_set()
            return "break"
        if len(matches) == 1 and query:
            self.select_product(matches[0])
            return "break"
        dialog = tk.Toplevel(self)
        dialog.title("Resultados da busca")
        dialog.geometry("680x390")
        dialog.minsize(540, 300)
        dialog.transient(self)
        dialog.grab_set()
        dialog.configure(bg=BG, padx=16, pady=14)
        tk.Label(dialog, text=f'{len(matches)} produtos encontrados' if query else "Catálogo completo", bg=BG, fg=INK,
                 font=("Segoe UI", 14, "bold")).pack(anchor="w", pady=(0, 4))
        tk.Label(dialog, text="Selecione com ↑/↓ ou mouse; Enter confirma.", bg=BG, fg=MUTED,
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(0, 10))
        tree = ttk.Treeview(dialog, columns=("barcode", "aux", "name", "price", "cost"), show="headings", selectmode="browse")
        for column, title, width in (("barcode", "Código de barras", 125), ("aux", "Código auxiliar", 115),
                                     ("name", "Produto", 270), ("price", "Venda", 85), ("cost", "Custo", 85)):
            tree.heading(column, text=title)
            tree.column(column, width=width, anchor="e" if column in {"price", "cost"} else "w")
        tree.pack(fill="both", expand=True)
        for index, product in enumerate(matches):
            cost, _source = self.ledger.product_unit_cost(product)
            tree.insert("", "end", iid=str(index), values=(product.get("barcode") or "—", product.get("auxiliary_code") or product["product_id"],
                product["name"], format_money(product["sale_price_cents"]), "Pendente" if cost is None else format_money(cost)))
        tree.selection_set("0")
        tree.focus("0")

        def choose(_event=None):
            selection = tree.selection()
            if selection:
                chosen = matches[int(selection[0])]
                dialog.destroy()
                self.select_product(chosen)
            return "break"

        tree.bind("<Double-1>", choose)
        tree.bind("<Return>", choose)
        buttons = tk.Frame(dialog, bg=BG)
        buttons.pack(fill="x", pady=(10, 0))
        tk.Button(buttons, text="Cancelar", command=dialog.destroy, bg="#E8EDE8", fg=INK, relief="flat", padx=12, pady=7).pack(side="right")
        tk.Button(buttons, text="Confirmar produto", command=choose, bg=GREEN, fg="white", relief="flat", padx=12, pady=7).pack(side="right", padx=(0, 8))
        tree.focus_set()
        return "break"

    def select_product(self, product):
        self.product_var.set(product["name"])
        self.price_var.set(_money_field(product["sale_price_cents"]))
        self.selected_product_label.configure(text=f"{product['product_id']}  ·  {product['name']}  ·  {format_money(product['sale_price_cents'])}")
        self.quantity_var.set("1")
        self.quantity_entry.focus_set()
        self.quantity_entry.selection_range(0, "end")

    def _cart_total(self):
        return sum(item["amount_cents"] for item in self.cart)

    def add_item(self, _event=None):
        try:
            product = next(p for p in self.products if p["name"] == self.product_var.get())
            quantity = Decimal(self.quantity_var.get().replace(",", "."))
            if quantity <= 0:
                raise ValueError("Quantidade precisa ser maior que zero.")
            unit_price = parse_money(self.price_var.get())
            amount = int((quantity * unit_price).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            if amount <= 0:
                raise ValueError("Total do item precisa ser maior que zero.")
            unit_cost, _source = self.ledger.product_unit_cost(product)
            self.cart.append({"product": product, "quantity": quantity, "unit_price_cents": unit_price,
                              "amount_cents": amount, "unit_cost_cents": unit_cost})
            self.render_cart()
            self.quantity_var.set("1")
            self.fill_pix()
        except (StopIteration, InvalidOperation, ValueError) as exc:
            messagebox.showerror("Item da venda", str(exc) or "Selecione um produto cadastrado.", parent=self)

    def render_cart(self):
        self.cart_tree.delete(*self.cart_tree.get_children())
        for index, item in enumerate(self.cart):
            product = item["product"]
            self.cart_tree.insert("", "end", iid=str(index), values=(product["name"], str(item["quantity"]),
                format_money(item["unit_price_cents"]), format_money(item["amount_cents"])))
        total = self._cart_total()
        self.total_label.configure(text=f"Total da venda  {format_money(total)}")
        self.update_preview()

    def remove_item(self):
        selected = self.cart_tree.selection()
        if selected:
            self.cart.pop(int(selected[0]))
            self.render_cart()
            self.fill_pix()

    def _rate(self, variable):
        value = Decimal(variable.get().replace("%", "").replace(",", ".").strip() or "0") / 100
        if value < 0 or value > 1:
            raise ValueError("Taxa precisa estar entre 0% e 100%.")
        return value

    def _payment_cents(self):
        result = {}
        for method, variable in self.payment_vars.items():
            value = variable.get().strip() or "0"
            normalized = value.replace("R$", "").replace(" ", "")
            if "," in normalized:
                normalized = normalized.replace(".", "").replace(",", ".")
            result[method] = 0 if Decimal(normalized) == 0 else parse_money(value)
        return result

    def fill_pix(self):
        try:
            other = sum(parse_money(self.payment_vars[m].get()) if self.payment_vars[m].get().strip() and self._payment_value_decimal(self.payment_vars[m].get()) > 0 else 0
                        for m in ("Dinheiro", "Débito", "Crédito"))
            remainder = self._cart_total() - other
            self.payment_vars["Pix"].set(_money_field(max(0, remainder)))
        except (ValueError, InvalidOperation):
            self.update_preview()
        self.update_preview()

    @staticmethod
    def _payment_value_decimal(value):
        normalized = value.replace("R$", "").replace(" ", "")
        if "," in normalized:
            normalized = normalized.replace(".", "").replace(",", ".")
        return Decimal(normalized or "0")

    def update_preview(self):
        if not hasattr(self, "preview_label"):
            return
        try:
            payments = self._payment_cents()
            debit = self._rate(self.debit_rate)
            credit = self._rate(self.credit_rate)
            fee = int((Decimal(payments["Débito"]) * debit + Decimal(payments["Crédito"]) * credit).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            total = self._cart_total()
            correct = sum(payments.values()) == total and total > 0
            self.preview_label.configure(text=f"Taxas: {format_money(fee)}   ·   Líquido recebido: {format_money(total - fee)}")
            self.payment_status.configure(text="Divisão confere com o total." if correct else f"Divisão {format_money(sum(payments.values()))} de {format_money(total)}", fg=GREEN if correct else RED)
            self.save_button.configure(state="normal" if correct else "disabled")
        except (ValueError, InvalidOperation):
            self.preview_label.configure(text="Revise os valores dos pagamentos e as taxas.")
            self.payment_status.configure(text="Valor inválido.", fg=RED)
            self.save_button.configure(state="disabled")

    def save_sale(self):
        try:
            sale_date = date.fromisoformat(self.sale_date.get().strip()).isoformat()
            if not self.cart:
                raise ValueError("Adicione pelo menos um produto à venda.")
            payments = self._payment_cents()
            rows = [{"method": method, "amount_cents": payments[method],
                     "fee_rate": str(self._rate(self.debit_rate) if method == "Débito" else self._rate(self.credit_rate) if method == "Crédito" else Decimal("0"))}
                    for method in self.METHODS]
            result = self.ledger.record_pos_sale(entry_date=sale_date, items=[{
                "name": item["product"]["name"], "category": item["product"]["category"],
                "quantity": str(item["quantity"]), "unit_price_cents": item["unit_price_cents"],
                "amount_cents": item["amount_cents"], "unit_cost_cents": item["unit_cost_cents"]} for item in self.cart],
                payments=rows, customer=self.customer_var.get(), notes=self.notes_var.get())
            messagebox.showinfo("Venda registrada", f"Venda bruta: {format_money(result['gross_cents'])}\n"
                f"Taxas: {format_money(result['fee_cents'])}\nRecebido líquido: {format_money(result['net_cents'])}", parent=self)
            self.cart.clear()
            self.render_cart()
            for variable in self.payment_vars.values():
                variable.set("0,00")
            self.customer_var.set("")
            self.notes_var.set("")
            self.refresh_report()
        except (ValueError, InvalidOperation) as exc:
            messagebox.showerror("Não foi possível registrar", str(exc), parent=self)

    def _range_today(self):
        value = date.today().isoformat()
        self.report_start.set(value)
        self.report_end.set(value)
        self.refresh_report()

    def _range_week(self):
        today = date.today()
        start = today - timedelta(days=today.weekday())
        self.report_start.set(start.isoformat())
        self.report_end.set(today.isoformat())
        self.refresh_report()

    def _range_month(self):
        today = date.today()
        self.report_start.set(today.replace(day=1).isoformat())
        self.report_end.set(today.isoformat())
        self.refresh_report()

    def refresh_report(self):
        try:
            start = date.fromisoformat(self.report_start.get().strip())
            end = date.fromisoformat(self.report_end.get().strip())
            if start > end:
                raise ValueError("A data inicial deve ser anterior à data final.")
            report = self.ledger.pos_report(start.isoformat(), end.isoformat())
            days = (end - start).days + 1
            previous_end = start - timedelta(days=1)
            previous_start = previous_end - timedelta(days=days - 1)
            previous = self.ledger.pos_report(previous_start.isoformat(), previous_end.isoformat())
        except ValueError as exc:
            messagebox.showerror("Período inválido", str(exc), parent=self)
            return
        self.metric_labels["gross"].configure(text=format_money(report["gross_cents"]))
        self.metric_labels["fees"].configure(text=format_money(report["fees_cents"]))
        self.metric_labels["net"].configure(text=format_money(report["net_cents"]))
        self.metric_labels["profit"].configure(text=format_money(report["profit_cents"]))
        diff = report["gross_cents"] - previous["gross_cents"]
        sign = "+" if diff >= 0 else "−"
        comparison_type = "dia anterior" if days == 1 else "período anterior de mesma duração"
        self.comparison_label.configure(text=f"Comparação com {comparison_type} ({previous_start:%d/%m/%Y} a {previous_end:%d/%m/%Y}): "
            f"bruto {format_money(previous['gross_cents'])}  ·  variação {sign}{format_money(abs(diff))}  ·  "
            f"líquido {format_money(report['net_cents'])}  ·  lucro estimado {format_money(report['profit_cents'])}")
        self.daily_tree.delete(*self.daily_tree.get_children())
        daily = {row["entry_date"]: int(row["gross_cents"]) for row in report["daily"]}
        for offset in range(days):
            key = (start + timedelta(days=offset)).isoformat()
            gross = daily.get(key, 0)
            entries_for_day = self.ledger.pos_report(key, key)
            self.daily_tree.insert("", "end", values=(key, format_money(gross), format_money(entries_for_day["fees_cents"]), format_money(entries_for_day["net_cents"])))
        self.product_tree.delete(*self.product_tree.get_children())
        for item in report["products"]:
            cost = "Pendente" if item["missing_cost_lines"] else format_money(int(item["cost_cents"] or 0))
            self.product_tree.insert("", "end", values=(item["description"], f"{Decimal(str(item['quantity'] or 0)):g}",
                format_money(int(item["gross_cents"])), cost))
        self.report_hint.configure(text=f"{report['entries_count']} itens vendidos  ·  pagamentos: " + "  ·  ".join(
            f"{method} {format_money(amount)}" for method, amount in report["payments"].items()) +
            (f"  ·  custo pendente em {report['missing_cost_lines']} linha(s); lucro estimado parcial."
             if report["missing_cost_lines"] else "  ·  lucro = bruto menos taxa e custo conhecido."))
        self._draw_chart(start, end, daily)

    def _draw_chart(self, start, end, daily):
        canvas = self.chart
        canvas.delete("all")
        canvas.update_idletasks()
        width = max(250, canvas.winfo_width())
        height = max(100, canvas.winfo_height())
        days = (end - start).days + 1
        stride = max(1, (days + 14) // 15)
        keys = [(start + timedelta(days=i)).isoformat() for i in range(0, days, stride)]
        values = [daily.get(key, 0) for key in keys]
        maximum = max(values, default=0) or 1
        pad_x, pad_y = 34, 22
        slot = (width - pad_x * 2) / max(1, len(keys))
        for i, (key, value) in enumerate(zip(keys, values)):
            bar_h = (height - pad_y * 2 - 20) * value / maximum
            x0 = pad_x + i * slot + slot * .18
            x1 = pad_x + (i + 1) * slot - slot * .18
            y1 = height - pad_y - 18
            y0 = y1 - bar_h
            canvas.create_rectangle(x0, y0, x1, y1, fill=GREEN, outline="")
            if days <= 15 or i % 2 == 0:
                canvas.create_text((x0 + x1) / 2, height - 13, text=date.fromisoformat(key).strftime("%d/%m"), fill=MUTED, font=("Segoe UI", 8))
            if value:
                canvas.create_text((x0 + x1) / 2, max(10, y0 - 8), text=format_money(value), fill=INK, font=("Segoe UI", 7))
        canvas.create_text(10, 10, anchor="nw", text="Venda bruta por dia", fill=MUTED, font=("Segoe UI", 8, "bold"))


def main():
    PosApp().mainloop()


if __name__ == "__main__":
    main()
