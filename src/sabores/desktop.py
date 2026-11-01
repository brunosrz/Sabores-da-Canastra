"""Interface desktop Tkinter do livro-caixa Sabores da Canastra."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk, simpledialog

from .database import Entry, Ledger

BG = "#F4F5F1"
PANEL = "#FFFFFF"
INK = "#1D2B24"
MUTED = "#718078"
GREEN = "#246B4B"
GOLD = "#C9953C"
RED = "#B94B42"


def parse_money(text: str) -> int:
    raw = text.strip().replace("R$", "").replace(" ", "")
    if not raw:
        raise ValueError("Informe um valor")
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    try:
        value = Decimal(raw).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise ValueError("Valor monetário inválido") from exc
    if value <= 0:
        raise ValueError("O valor precisa ser maior que zero")
    return int(value * 100)


def format_money(cents: int) -> str:
    value = f"{Decimal(cents) / 100:,.2f}"
    return "R$ " + value.replace(",", "X").replace(".", ",").replace("X", ".")


class LedgerApp(tk.Tk):
    def __init__(self, db_path: str | Path | None = None):
        super().__init__()
        self.title("Sabores da Canastra | Caixa diário")
        self.geometry("1280x820")
        self.minsize(1050, 700)
        default_path = Path.home() / ".sabores-da-canastra" / "sabores.db"
        self.ledger = Ledger(db_path or default_path)
        self._import_legacy_catalog()
        self.configure(bg=BG)
        self._configure_style()
        self._build()
        self._build_tabs()
        self.refresh()

    def _import_legacy_catalog(self):
        """One-time import of existing workbook catalog into SQLite, without confirming estimates."""
        if self.ledger.list_recipes():
            return
        workbook = Path(__file__).resolve().parents[2] / "sabores_da_canastra_custos_salgados.xlsx"
        if not workbook.exists():
            return
        try:
            from openpyxl import load_workbook
            wb = load_workbook(workbook, data_only=False, read_only=True)
            ins = wb["Insumos"]
            for row in range(5, ins.max_row + 1):
                name = ins.cell(row, 1).value
                if not name:
                    continue
                self.ledger.upsert_ingredient(name=name, base_unit=str(ins.cell(row, 2).value),
                    pack_quantity=str(ins.cell(row, 3).value),
                    pack_price_cents=round(float(ins.cell(row, 4).value) * 100) if ins.cell(row, 4).value is not None else None,
                    price_status="Estimado", source="Importado da planilha existente; cotação não verificada",
                    notes=str(ins.cell(row, 7).value or ""))
            fichas = wb["Fichas"]
            composition = wb["Composicao"]
            by_recipe = {}
            for row in range(5, composition.max_row + 1):
                rid = composition.cell(row, 1).value
                if not rid:
                    continue
                by_recipe.setdefault(rid, []).append((str(composition.cell(row, 3).value),
                    str(composition.cell(row, 4).value), str(composition.cell(row, 5).value),
                    str(composition.cell(row, 2).value or "")))
            mix = wb["Mix diario"]
            selected = {}
            for row in range(5, 13):
                flavor = mix.cell(row, 1).value
                version = mix.cell(row, 4).value or "E"
                quantity = int(mix.cell(row, 3).value or 0)
                if flavor:
                    selected[flavor] = (version, quantity)
            imported_recipes = []
            for row in range(5, fichas.max_row + 1):
                rid = fichas.cell(row, 1).value
                if not rid:
                    continue
                name = str(fichas.cell(row, 3).value)
                version = "E" if str(fichas.cell(row, 4).value).lower().startswith("econ") else "R"
                self.ledger.upsert_recipe(recipe_id=rid, product_name=name, version=version,
                    yield_units=int(fichas.cell(row, 5).value), source=str(fichas.cell(row, 6).value or ""),
                    instructions=str(fichas.cell(row, 7).value or ""), lines=by_recipe.get(rid, []))
                imported_recipes.append((rid, str(fichas.cell(row, 2).value), version))
            for rid, flavor, version in imported_recipes:
                if flavor in selected and selected[flavor][0] == version:
                    self.ledger.set_mix(rid, selected[flavor][1], version)
            wb.close()
        except Exception as exc:
            # Do not make a failed optional migration prevent opening the daily ledger.
            self.after(500, lambda: messagebox.showwarning("Importação da planilha",
                f"Não foi possível importar as fichas automaticamente: {exc}", parent=self))

    def _configure_style(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("Treeview", background=PANEL, fieldbackground=PANEL, foreground=INK,
                        rowheight=34, borderwidth=0, font=("Segoe UI", 10))
        style.configure("Treeview.Heading", background="#E8EDE8", foreground=INK,
                        font=("Segoe UI Semibold", 9), relief="flat")
        style.map("Treeview", background=[("selected", "#DCEBE2")], foreground=[("selected", INK)])
        style.configure("TCombobox", padding=7)

    def _build(self):
        shell = tk.Frame(self, bg=BG, padx=30, pady=24)
        shell.pack(fill="both", expand=True)
        header = tk.Frame(shell, bg=BG)
        header.pack(fill="x", pady=(0, 20))
        tk.Label(header, text="SABORES DA CANASTRA", bg=BG, fg=GREEN,
                 font=("Segoe UI", 10, "bold")).pack(anchor="w")
        titleline = tk.Frame(header, bg=BG)
        titleline.pack(fill="x", pady=(5, 0))
        tk.Label(titleline, text="Caixa diário", bg=BG, fg=INK,
                 font=("Segoe UI", 25, "bold")).pack(side="left")
        tk.Label(titleline, text="REGISTRO DE VENDAS · COMPRAS · GASTOS", bg=BG, fg=MUTED,
                 font=("Segoe UI", 9, "bold")).pack(side="right", pady=12)

        self.main_notebook = ttk.Notebook(shell)
        self.main_notebook.pack(fill="both", expand=True)
        ledger_tab = tk.Frame(self.main_notebook, bg=BG)
        self.main_notebook.add(ledger_tab, text="  Caixa diário  ")

        self.summary_frame = tk.Frame(ledger_tab, bg=BG)
        self.summary_frame.pack(fill="x", pady=(0, 18))
        self.cards = {}
        for title, key, color in [("VENDAS HOJE", "Venda", GREEN), ("COMPRAS HOJE", "Compra", GOLD),
                                  ("GASTOS HOJE", "Gasto", RED), ("SALDO DO DIA", "Resultado", INK)]:
            card = tk.Frame(self.summary_frame, bg=PANEL, padx=17, pady=14,
                            highlightbackground="#E5EAE5", highlightthickness=1)
            card.pack(side="left", fill="x", expand=True, padx=(0, 10))
            tk.Label(card, text=title, bg=PANEL, fg=MUTED, font=("Segoe UI", 9, "bold")).pack(anchor="w")
            value = tk.Label(card, text="R$ 0,00", bg=PANEL, fg=color, font=("Segoe UI", 20, "bold"))
            value.pack(anchor="w", pady=(7, 0))
            self.cards[key] = value

        content = tk.Frame(ledger_tab, bg=BG)
        content.pack(fill="both", expand=True)
        left = tk.Frame(content, bg=PANEL, padx=20, pady=18,
                        highlightbackground="#E5EAE5", highlightthickness=1)
        left.pack(side="left", fill="y", padx=(0, 18))
        left.configure(width=340)
        left.pack_propagate(False)
        tk.Label(left, text="Novo lançamento", bg=PANEL, fg=INK,
                 font=("Segoe UI", 15, "bold")).pack(anchor="w", pady=(0, 14))
        self.kind = tk.StringVar(value="Venda")
        self.entry_date = tk.StringVar(value=date.today().isoformat())
        self.category = tk.StringVar(value="Salgados")
        self.description = tk.StringVar()
        self.quantity = tk.StringVar()
        self.unit_price = tk.StringVar()
        self.amount = tk.StringVar()
        self.payment = tk.StringVar(value="Pix")
        self.counterparty = tk.StringVar()
        self.notes = tk.StringVar()
        self._field(left, "Tipo", ttk.Combobox(left, textvariable=self.kind, values=["Venda", "Compra", "Gasto"], state="readonly"))
        self._field(left, "Data (AAAA-MM-DD)", ttk.Entry(left, textvariable=self.entry_date))
        self.category_combo = ttk.Combobox(left, textvariable=self.category, values=self._suggestions("Venda"))
        self._field(left, "Categoria", self.category_combo)
        self._field(left, "Descrição", ttk.Entry(left, textvariable=self.description))
        numbers = tk.Frame(left, bg=PANEL)
        numbers.pack(fill="x", pady=(0, 9))
        self._mini_field(numbers, "Quantidade", self.quantity, 11)
        self._mini_field(numbers, "Valor unitário", self.unit_price, 14)
        self._field(left, "Valor total (R$)", ttk.Entry(left, textvariable=self.amount))
        self._field(left, "Pagamento", ttk.Combobox(left, textvariable=self.payment,
                    values=["Pix", "Dinheiro", "Débito", "Crédito", "Transferência", "Outro"], state="readonly"))
        self._field(left, "Fornecedor / cliente", ttk.Entry(left, textvariable=self.counterparty))
        self._field(left, "Observação", ttk.Entry(left, textvariable=self.notes))
        self.kind.trace_add("write", self._kind_changed)
        self.amount.trace_add("write", self._calculate_total)
        self.quantity.trace_add("write", self._calculate_total)
        self.unit_price.trace_add("write", self._calculate_total)
        tk.Button(left, text="Salvar lançamento", command=self.save_entry, bg=GREEN, fg="white",
                  activebackground="#1D583D", activeforeground="white", relief="flat",
                  cursor="hand2", font=("Segoe UI", 10, "bold"), padx=12, pady=11).pack(fill="x", pady=(8, 0))

        right = tk.Frame(content, bg=PANEL, padx=20, pady=18,
                         highlightbackground="#E5EAE5", highlightthickness=1)
        right.pack(side="left", fill="both", expand=True)
        toolbar = tk.Frame(right, bg=PANEL)
        toolbar.pack(fill="x", pady=(0, 14))
        tk.Label(toolbar, text="Histórico", bg=PANEL, fg=INK, font=("Segoe UI", 15, "bold")).pack(side="left")
        self.filter_start = tk.StringVar(value=(date.today() - timedelta(days=30)).isoformat())
        self.filter_end = tk.StringVar(value=date.today().isoformat())
        self.filter_kind = tk.StringVar(value="Todos")
        self._toolbar_field(toolbar, "De", ttk.Entry(toolbar, textvariable=self.filter_start, width=12))
        self._toolbar_field(toolbar, "Até", ttk.Entry(toolbar, textvariable=self.filter_end, width=12))
        self._toolbar_field(toolbar, "Tipo", ttk.Combobox(toolbar, textvariable=self.filter_kind,
                            values=["Todos", "Venda", "Compra", "Gasto"], state="readonly", width=11))
        tk.Button(toolbar, text="Filtrar", command=self.refresh, bg="#E8EDE8", fg=INK,
                  relief="flat", padx=12, pady=7, cursor="hand2").pack(side="right", padx=(8, 0))
        columns = ("date", "kind", "category", "description", "amount", "payment", "counterparty")
        self.table = ttk.Treeview(right, columns=columns, show="headings", selectmode="browse")
        labels = {"date":"Data", "kind":"Tipo", "category":"Categoria", "description":"Descrição",
                  "amount":"Valor", "payment":"Pagamento", "counterparty":"Fornecedor / cliente"}
        widths = {"date":95, "kind":80, "category":125, "description":190, "amount":110,
                  "payment":105, "counterparty":160}
        for col in columns:
            self.table.heading(col, text=labels[col])
            self.table.column(col, width=widths[col], anchor="e" if col == "amount" else "w")
        self.table.pack(fill="both", expand=True)
        self.table.tag_configure("Venda", foreground=GREEN)
        self.table.tag_configure("Compra", foreground="#976A1C")
        self.table.tag_configure("Gasto", foreground=RED)
        bottom = tk.Frame(right, bg=PANEL)
        bottom.pack(fill="x", pady=(12, 0))
        self.history_total = tk.Label(bottom, text="", bg=PANEL, fg=MUTED, font=("Segoe UI", 10))
        self.history_total.pack(side="left")
        tk.Button(bottom, text="Excluir selecionado", command=self.delete_selected, bg="#F8E9E6", fg=RED,
                  relief="flat", padx=10, pady=7, cursor="hand2").pack(side="right")

    def _build_tabs(self):
        self.costs_tab = tk.Frame(self.main_notebook, bg=BG, padx=28, pady=22)
        self.main_notebook.add(self.costs_tab, text="  Custos & receitas  ")
        self.production_tab = tk.Frame(self.main_notebook, bg=BG, padx=28, pady=22)
        self.main_notebook.add(self.production_tab, text="  Produção & compras  ")
        self.reports_tab = tk.Frame(self.main_notebook, bg=BG, padx=28, pady=22)
        self.main_notebook.add(self.reports_tab, text="  Relatórios  ")
        self._build_costs_tab()
        self._build_production_tab()
        self._build_reports_tab()

    def _section_title(self, parent, title, subtitle):
        tk.Label(parent, text=title, bg=BG, fg=INK, font=("Segoe UI", 20, "bold")).pack(anchor="w")
        tk.Label(parent, text=subtitle, bg=BG, fg=MUTED, font=("Segoe UI", 10)).pack(anchor="w", pady=(3, 18))

    def _build_costs_tab(self):
        self._section_title(self.costs_tab, "Custos & receitas", "Cadastre preços de pacote e acompanhe as fichas técnicas migradas para o banco local.")
        body = tk.Frame(self.costs_tab, bg=BG)
        body.pack(fill="both", expand=True)
        form = tk.Frame(body, bg=PANEL, padx=18, pady=18, highlightbackground="#E5EAE5", highlightthickness=1)
        form.pack(side="left", fill="y", padx=(0, 16))
        tk.Label(form, text="Novo / atualizar ingrediente", bg=PANEL, fg=INK, font=("Segoe UI", 13, "bold")).pack(anchor="w", pady=(0, 12))
        self.ingredient_name = tk.StringVar()
        self.ingredient_unit = tk.StringVar(value="g")
        self.ingredient_pack_qty = tk.StringVar(value="1000")
        self.ingredient_price = tk.StringVar()
        self.ingredient_supplier = tk.StringVar()
        self.ingredient_status = tk.StringVar(value="Pendente")
        self.ingredient_source = tk.StringVar()
        for label, var in [("Ingrediente",self.ingredient_name),("Unidade base (g/ml/un)",self.ingredient_unit),
                           ("Quantidade no pacote",self.ingredient_pack_qty),("Preço pacote (R$)",self.ingredient_price),
                           ("Fornecedor",self.ingredient_supplier),("Fonte / URL",self.ingredient_source)]:
            self._field(form,label,ttk.Entry(form,textvariable=var))
        self._field(form,"Status do preço",ttk.Combobox(form,textvariable=self.ingredient_status,
                    values=["Confirmado","Estimado","Pendente","Desatualizado"],state="readonly"))
        tk.Button(form,text="Salvar ingrediente",command=self.save_ingredient,bg=GREEN,fg="white",relief="flat",
                  font=("Segoe UI",10,"bold"),padx=12,pady=10).pack(fill="x",pady=(5,0))
        tk.Label(form,text="Edite um preço: selecione ingrediente e informe preço, fornecedor e data abaixo.",bg=PANEL,fg=MUTED,wraplength=250,justify="left").pack(anchor="w",pady=(18,8))
        self.price_name=tk.StringVar();self.price_value=tk.StringVar();self.price_date=tk.StringVar(value=date.today().isoformat())
        self.price_supplier=tk.StringVar();self.price_source=tk.StringVar();self.price_status=tk.StringVar(value="Confirmado")
        self.price_combo=ttk.Combobox(form,textvariable=self.price_name,state="readonly")
        self._field(form,"Ingrediente existente",self.price_combo)
        self._field(form,"Status da cotação",ttk.Combobox(form,textvariable=self.price_status,
                    values=["Confirmado","Estimado","Pendente","Desatualizado"],state="readonly"))
        self._field(form,"Novo preço do pacote (R$)",ttk.Entry(form,textvariable=self.price_value))
        self._field(form,"Data da cotação",ttk.Entry(form,textvariable=self.price_date))
        self._field(form,"Fornecedor",ttk.Entry(form,textvariable=self.price_supplier))
        self._field(form,"Fonte / URL",ttk.Entry(form,textvariable=self.price_source))
        tk.Button(form,text="Atualizar cotação",command=self.save_price,bg="#E8EDE8",fg=INK,relief="flat",padx=10,pady=8).pack(fill="x")
        listing = tk.Frame(body,bg=PANEL,padx=18,pady=18,highlightbackground="#E5EAE5",highlightthickness=1)
        listing.pack(side="left",fill="both",expand=True)
        tk.Label(listing,text="Ingredientes",bg=PANEL,fg=INK,font=("Segoe UI",14,"bold")).pack(anchor="w",pady=(0,10))
        self.ingredient_table = ttk.Treeview(listing,columns=("name","unit","pack","price","supplier","status"),show="headings")
        for col,label,width in [("name","Ingrediente",210),("unit","Unid.",65),("pack","Pacote",90),("price","Preço",105),("supplier","Fornecedor",150),("status","Status",110)]:
            self.ingredient_table.heading(col,text=label); self.ingredient_table.column(col,width=width)
        self.ingredient_table.pack(fill="both",expand=True)
        tk.Label(listing,text="Receitas e composições",bg=PANEL,fg=INK,font=("Segoe UI",13,"bold")).pack(anchor="w",pady=(18,8))
        self.recipe_table=ttk.Treeview(listing,columns=("recipe","version","yield","cost"),show="headings",height=8)
        for col,label,width in [("recipe","Salgado",250),("version","Versão",110),("yield","Rendimento",100),("cost","Custo unitário",125)]:
            self.recipe_table.heading(col,text=label); self.recipe_table.column(col,width=width)
        self.recipe_table.pack(fill="x")
        tk.Label(listing,text="Editar ficha: duplo clique em rendimento ou quantidade de ingrediente.",bg=PANEL,fg=MUTED,font=("Segoe UI",9)).pack(anchor="w",pady=(6,0))
        self.recipe_table.bind("<Double-1>",self.edit_recipe_cell)

    def _build_production_tab(self):
        self._section_title(self.production_tab, "Produção & compras", "Escolha o mix diário. A quantidade é a meta de venda; lotes podem gerar excedente para estoque.")
        top=tk.Frame(self.production_tab,bg=PANEL,padx=18,pady=15,highlightbackground="#E5EAE5",highlightthickness=1)
        top.pack(fill="x",pady=(0,16))
        tk.Label(top,text="Meta diária de salgados",bg=PANEL,fg=MUTED,font=("Segoe UI",9,"bold")).pack(side="left")
        self.daily_target=tk.StringVar(value="25")
        ttk.Entry(top,textvariable=self.daily_target,width=8).pack(side="left",padx=10)
        tk.Button(top,text="Salvar mix",command=self.save_mix,bg=GREEN,fg="white",relief="flat",padx=12,pady=7).pack(side="left")
        self.mix_table=ttk.Treeview(self.production_tab,columns=("recipe","version","yield","qty","batches","excess"),show="headings")
        for col,label,width in [("recipe","Salgado",280),("version","Versão",130),("yield","Rende/lote",110),("qty","Venda/dia",110),("batches","Lotes/dia",110),("excess","Excedente",110)]:
            self.mix_table.heading(col,text=label); self.mix_table.column(col,width=width)
        self.mix_table.pack(fill="both",expand=True)
        self.mix_table.bind("<Double-1>",self.edit_mix_cell)
        self.shopping_box=tk.Text(self.production_tab,height=10,wrap="word",font=("Segoe UI",10),bg=PANEL,fg=INK,relief="flat",padx=12,pady=10)
        self.shopping_box.pack(fill="x",pady=(16,0))

    def _build_reports_tab(self):
        self._section_title(self.reports_tab, "Relatórios", "Caixa realizado e simulação de referência. Dados de planejamento não são lançamentos reais.")
        self.month_var=tk.StringVar(value=date.today().strftime("%Y-%m"))
        bar=tk.Frame(self.reports_tab,bg=PANEL,padx=16,pady=12);bar.pack(fill="x")
        tk.Label(bar,text="Mês (AAAA-MM)",bg=PANEL,fg=MUTED).pack(side="left")
        ttk.Entry(bar,textvariable=self.month_var,width=12).pack(side="left",padx=8)
        tk.Button(bar,text="Atualizar",command=self.refresh_reports,bg=GREEN,fg="white",relief="flat",padx=12,pady=7).pack(side="left")
        self.report_text=tk.Text(self.reports_tab,wrap="word",font=("Segoe UI",12),bg=PANEL,fg=INK,relief="flat",padx=20,pady=18)
        self.report_text.pack(fill="both",expand=True,pady=(14,0))
        settings=tk.Frame(self.reports_tab,bg=PANEL,padx=16,pady=14);settings.pack(fill="x",pady=(12,0))
        tk.Label(settings,text="Premissas do cenário",bg=PANEL,fg=INK,font=("Segoe UI",12,"bold")).pack(anchor="w",pady=(0,8))
        param_grid=tk.Frame(settings,bg=PANEL);param_grid.pack(fill="x")
        self.params_vars={}
        defaults=[("salty_price","Preço salgado", "7.00"),("savouries_day","Salgados/dia","25"),
                  ("drink_price","Preço lata","6.00"),("drinks_day","Latas/dia","20"),
                  ("days_month","Dias/mês","20"),("drink_cost","Custo lata agregado","3.50"),
                  ("km_day","Km mínimos/dia","22"),("km_buffer","Folga km (%)","15"),
                  ("km_per_l","Km/litro","40"),("fuel_price","Gasolina/litro","7.00"),
                  ("debit_share","Débito (%)","25"),("debit_rate","Taxa débito (%)","1.39"),
                  ("credit_share","Crédito (%)","25"),("credit_rate","Taxa crédito (%)","3.34"),
                  ("monthly_fixed","Fixos mensais","100"),("hourly_labor","Mão de obra/h","0"),
                  ("work_hours","Horas produção/lote","2"),("tax_rate","Tributos (%)","0")]
        for index,(key,label,default) in enumerate(defaults):
            self.ledger.upsert_parameter(key,default,"", "Estimado")
            var=tk.StringVar(value=self.ledger.parameters().get(key,{}).get("value",default));self.params_vars[key]=var
            cell=tk.Frame(param_grid,bg=PANEL);cell.grid(row=index//6,column=index%6,sticky="ew",padx=5,pady=4)
            tk.Label(cell,text=label,bg=PANEL,fg=MUTED,font=("Segoe UI",8)).pack(anchor="w")
            ttk.Entry(cell,textvariable=var,width=12).pack(fill="x")
            param_grid.grid_columnconfigure(index%6,weight=1)
        tk.Button(settings,text="Salvar premissas e recalcular",command=self.save_parameters,bg=GREEN,fg="white",relief="flat",padx=12,pady=8).pack(anchor="w",padx=5,pady=(10,0))
        self.refresh_reports()

    def save_ingredient(self):
        try:
            pack_price=parse_money(self.ingredient_price.get()) if self.ingredient_price.get().strip() else None
            self.ledger.upsert_ingredient(name=self.ingredient_name.get(),base_unit=self.ingredient_unit.get(),
                pack_quantity=self.ingredient_pack_qty.get(),pack_price_cents=pack_price,
                supplier=self.ingredient_supplier.get(),price_status=self.ingredient_status.get(),source=self.ingredient_source.get())
        except ValueError as exc:
            messagebox.showerror("Ingrediente",str(exc),parent=self);return
        self.refresh_catalogs()

    def save_price(self):
        try:
            self.ledger.update_ingredient_price(self.price_name.get(),pack_price_cents=parse_money(self.price_value.get()),
                supplier=self.price_supplier.get(),price_date=self.price_date.get(),price_status=self.price_status.get(),source=self.price_source.get())
        except (ValueError,KeyError) as exc:
            messagebox.showerror("Cotação",str(exc),parent=self);return
        self.refresh_catalogs()

    def edit_recipe_cell(self,event):
        item=self.recipe_table.identify_row(event.y)
        col=self.recipe_table.identify_column(event.x)
        if not item:return
        rid=item.removeprefix("recipe:")
        recipe=self.ledger.recipe(rid)
        if not recipe:return
        if col=="#3":
            value=simpledialog.askinteger("Rendimento do lote","Unidades por lote:",initialvalue=recipe["yield_units"],minvalue=1,parent=self)
            if value is not None:self.ledger.adjust_recipe_yield(rid,value);self.refresh_catalogs()
        elif col=="#1":
            lines=recipe["lines"]
            if not lines:return
            win=tk.Toplevel(self);win.title("Composição da receita");win.configure(bg=BG);win.transient(self)
            tk.Label(win,text=f"{recipe['product_name']} · {recipe['version']}",bg=BG,fg=INK,font=("Segoe UI",13,"bold")).pack(anchor="w",padx=16,pady=12)
            vars_=[]
            for line in lines:
                row=tk.Frame(win,bg=BG);row.pack(fill="x",padx=16,pady=3)
                tk.Label(row,text=f"{line['ingredient_name']} ({line['unit']})",bg=BG,fg=INK,width=34,anchor="w").pack(side="left")
                var=tk.StringVar(value=line["quantity"]);ttk.Entry(row,textvariable=var,width=12).pack(side="left")
                vars_.append((line,var))
            def save_lines():
                try:
                    for line,var in vars_:self.ledger.update_recipe_line(rid,line["ingredient_name"],var.get(),line["stage"] or "")
                except (ValueError,KeyError) as exc:messagebox.showerror("Composição",str(exc),parent=win);return
                win.destroy();self.refresh_catalogs()
            tk.Button(win,text="Salvar composição",command=save_lines,bg=GREEN,fg="white",relief="flat",padx=14,pady=9).pack(pady=14)

    def edit_mix_cell(self,event):
        region=self.mix_table.identify("region",event.x,event.y)
        column=self.mix_table.identify_column(event.x)
        if region!="cell" or column not in {"#4"}: return
        row=self.mix_table.identify_row(event.y)
        if not row:return
        values=list(self.mix_table.item(row,"values"))
        dialog=tk.Toplevel(self);dialog.title("Editar mix");dialog.transient(self);dialog.grab_set();dialog.configure(bg=BG)
        tk.Label(dialog,text=values[0],bg=BG,fg=INK,font=("Segoe UI",12,"bold")).pack(padx=20,pady=(18,8))
        quantity=tk.StringVar(value=str(values[3]));version=tk.StringVar(value=values[1])
        ttk.Entry(dialog,textvariable=quantity).pack(padx=20,pady=5)
        ttk.Combobox(dialog,textvariable=version,values=["E","R"],state="readonly").pack(padx=20,pady=5)
        def save():
            try:self.ledger.set_mix(values[4],int(quantity.get()),version.get())
            except (ValueError,IndexError) as exc:messagebox.showerror("Mix",str(exc),parent=dialog);return
            dialog.destroy();self.refresh_catalogs()
        tk.Button(dialog,text="Salvar",command=save,bg=GREEN,fg="white",relief="flat",padx=15,pady=8).pack(pady=16)

    def save_mix(self):
        try: target=int(self.daily_target.get())
        except ValueError: messagebox.showerror("Meta","Informe uma meta diária inteira.",parent=self);return
        rows=self.ledger.list_mix()
        selected=[r for r in rows if r["version"]==r["selected_version"]]
        if sum(r["quantity"] for r in selected)!=target:
            messagebox.showerror("Mix",f"O mix selecionado soma {sum(r['quantity'] for r in selected)}; a meta é {target}.",parent=self);return
        self.refresh_catalogs()

    def refresh_catalogs(self):
        for tree in [self.ingredient_table,self.recipe_table,self.mix_table]:tree.delete(*tree.get_children())
        for item in self.ledger.list_ingredients():
            price="Pendente" if item["pack_price_cents"] is None else format_money(item["pack_price_cents"])
            self.ingredient_table.insert("","end",values=(item["name"],item["base_unit"],item["pack_quantity"],price,item["supplier"] or "—",item["price_status"]))
        self.price_combo.configure(values=[i["name"] for i in self.ledger.list_ingredients()])
        if not self.price_name.get() and self.ledger.list_ingredients():self.price_name.set(self.ledger.list_ingredients()[0]["name"])
        recipes=self.ledger.list_recipes()
        for r in recipes:
            cost=self.ledger.recipe_cost(r["recipe_id"])
            unit="Pendente" if cost["unit_cost_cents"] is None else format_money(cost["unit_cost_cents"])
            self.recipe_table.insert("","end",values=(r["product_name"],r["version"],r["yield_units"],unit),iid="recipe:"+r["recipe_id"])
        rows=self.ledger.list_mix()
        chosen=[r for r in rows if r["version"]==r["selected_version"]]
        self.daily_target.set(str(sum(r["quantity"] for r in chosen) or 25))
        for r in chosen:
            need=max(r["quantity"],0);batches=(need+r["yield_units"]-1)//r["yield_units"] if need else 0
            excess=max(batches*r["yield_units"]-need,0)
            self.mix_table.insert("","end",values=(r["product_name"],r["selected_version"],r["yield_units"],r["quantity"],batches,excess),iid="mix:"+r["recipe_id"])
        self.shopping_box.delete("1.0","end")
        self.shopping_box.insert("end","Lista de compras calculada a partir do mix selecionado: ajuste preços e composição para obter custos confiáveis.\n\n")
        for item in self.ledger.shopping_list():
            packs=f" · comprar {item['packages']} pacote(s)" if item["packages"] is not None else " · embalagem pendente"
            price=f" · preço {format_money(item['price_cents'])}" if item["price_cents"] is not None else " · preço pendente"
            self.shopping_box.insert("end",f"• {item['name']}: {item['quantity']:g} {item['unit']}{packs}{price} [{item['status']}]\n")
        self.refresh_reports()

    def refresh_reports(self):
        if not hasattr(self,"report_text"):return
        try:year,month=map(int,self.month_var.get().split("-"))
        except (ValueError,AttributeError):return
        summary=self.ledger.monthly_summary(year,month)
        self.report_text.delete("1.0","end")
        self.report_text.insert("end",f"CAIXA REALIZADO · {year:04d}-{month:02d}\n\n")
        for key in ["Venda","Compra","Gasto","Resultado"]:self.report_text.insert("end",f"{key:18} {format_money(summary[key])}\n")
        self.report_text.insert("end","\nResultado é venda menos compras e gastos registrados. Não representa lucro líquido contábil.\n")
        try:
            from .finance import baseline_finance
            vals={key:Decimal(var.get().replace(",",".")) for key,var in self.params_vars.items()}
            if vals["debit_share"] + vals["credit_share"] > 100:
                raise ValueError("Participações de pagamento excedem 100%")
            plan=baseline_finance(savouries_per_day=vals["savouries_day"],savoury_price=vals["salty_price"],
                drinks_per_day=vals["drinks_day"],drink_price=vals["drink_price"],days_per_month=vals["days_month"],
                drink_cost=vals["drink_cost"],km_minimum=vals["km_day"],km_buffer_pct=vals["km_buffer"]/100,
                km_per_litre=vals["km_per_l"],fuel_price=vals["fuel_price"],debit_share=vals["debit_share"]/100,
                credit_share=vals["credit_share"]/100,debit_rate=vals["debit_rate"]/100,credit_rate=vals["credit_rate"]/100)
            recipe_daily=Decimal("0")
            missing=[]
            for row in self.ledger.list_mix():
                if row["version"]!=row["selected_version"] or not row["quantity"]:continue
                rid=row["recipe_id"].rsplit("_",1)[0]+"_"+row["selected_version"]
                cost=self.ledger.recipe_cost(rid)
                if cost["unit_cost_cents"] is None:missing.extend(cost["pending_ingredients"])
                else:recipe_daily+=Decimal(row["quantity"])*Decimal(cost["unit_cost_cents"])/100
            days=vals["days_month"]
            selected_count=sum(1 for item in self.ledger.list_mix() if item["quantity"] and item["version"]==item["selected_version"])
            salaried_month=vals["hourly_labor"]*vals["work_hours"]*selected_count*days
            tax_month=plan.monthly_revenue*vals["tax_rate"]/100
            operating=plan.buffered_reference_balance - recipe_daily*days - vals["monthly_fixed"] - salaried_month - tax_month
            if missing:
                self.report_text.insert("end",f"\nPLANEJAMENTO: custo de salgados pendente de preço para {', '.join(sorted(set(missing)))}.\n")
            else:
                self.report_text.insert("end",f"\nCusto de salgados/dia pelo mix: {format_money(round(recipe_daily*100))}\n")
            self.report_text.insert("end",f"\nPLANEJAMENTO CONFIGURÁVEL (não realizado)\nFaturamento projetado: {format_money(round(plan.monthly_revenue*100))}\nSaldo antes de receitas/outros custos: {format_money(round(plan.buffered_reference_balance*100))}\nResultado após custo direto do mix e fixos cadastrados: {format_money(round(operating*100))}\n")
        except Exception as exc:
            self.report_text.insert("end",f"\nPreencha premissas numéricas válidas para calcular o cenário ({exc}).\n")

    def save_parameters(self):
        try:
            for key,var in self.params_vars.items():
                value=Decimal(var.get().replace(",","."))
                self.ledger.upsert_parameter(key,str(value),"", "Estimado")
            self.refresh_reports()
        except (InvalidOperation,ValueError) as exc:
            messagebox.showerror("Premissas",f"Revise os valores numéricos: {exc}",parent=self)

    def _field(self, parent, label, widget):
        tk.Label(parent, text=label, bg=PANEL, fg=MUTED, font=("Segoe UI", 9, "bold")).pack(anchor="w", pady=(0, 4))
        widget.pack(fill="x", pady=(0, 10), ipady=4) if isinstance(widget, ttk.Entry) else widget.pack(fill="x", pady=(0, 10))

    def _mini_field(self, parent, label, variable, width):
        child = tk.Frame(parent, bg=PANEL)
        child.pack(side="left", fill="x", expand=True, padx=(0, 7))
        tk.Label(child, text=label, bg=PANEL, fg=MUTED, font=("Segoe UI", 8, "bold")).pack(anchor="w", pady=(0, 4))
        ttk.Entry(child, textvariable=variable, width=width).pack(fill="x", ipady=4)

    def _toolbar_field(self, parent, label, widget):
        box = tk.Frame(parent, bg=PANEL)
        box.pack(side="right", padx=(10, 0))
        tk.Label(box, text=label, bg=PANEL, fg=MUTED, font=("Segoe UI", 8)).pack(anchor="w")
        widget.pack()

    def _suggestions(self, kind):
        return {"Venda": ["Salgados", "Refrigerantes", "Suco", "Doces", "Outros"],
                "Compra": ["Ingredientes", "Bebidas", "Embalagens", "Limpeza", "Combustível", "Outros"],
                "Gasto": ["Combustível", "Gás", "Energia", "Manutenção", "Taxas", "Limpeza", "Outros"]}[kind]

    def _kind_changed(self, *_):
        kind = self.kind.get()
        self.category_combo.configure(values=self._suggestions(kind))
        self.category.set(self._suggestions(kind)[0])
        self.payment.set("Pix" if kind == "Venda" else "Dinheiro")

    def _calculate_total(self, *_):
        try:
            q = Decimal(self.quantity.get().replace(",", "."))
            unit = Decimal(self.unit_price.get().replace("R$", "").strip().replace(",", "."))
            cents = int((q * unit * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            self.amount.set(f"{Decimal(cents)/100:.2f}".replace(".", ","))
        except (InvalidOperation, ValueError):
            pass

    def save_entry(self):
        try:
            amount_cents = parse_money(self.amount.get())
            quantity = self.quantity.get().strip() or None
            unit_cents = parse_money(self.unit_price.get()) if self.unit_price.get().strip() else None
            if quantity and unit_cents is None:
                raise ValueError("Informe o valor unitário ou apague a quantidade")
            self.ledger.add_entry(entry_date=self.entry_date.get().strip(), kind=self.kind.get(),
                                  category=self.category.get(), description=self.description.get(),
                                  amount_cents=amount_cents, quantity=quantity,
                                  unit_price_cents=unit_cents, payment_method=self.payment.get(),
                                  supplier_or_customer=self.counterparty.get(), notes=self.notes.get())
        except ValueError as exc:
            messagebox.showerror("Confira o lançamento", str(exc), parent=self)
            return
        self.description.set("")
        self.quantity.set("")
        self.unit_price.set("")
        self.amount.set("")
        self.counterparty.set("")
        self.notes.set("")
        self.refresh()

    def refresh(self):
        today = date.today().isoformat()
        summary = self.ledger.daily_summary(today)
        for key, label in self.cards.items():
            label.configure(text=format_money(summary[key]))
        try:
            entries = self.ledger.list_entries(start_date=self.filter_start.get().strip() or None,
                                                end_date=self.filter_end.get().strip() or None,
                                                kind=self.filter_kind.get())
        except ValueError as exc:
            messagebox.showerror("Filtro inválido", str(exc), parent=self)
            return
        self.table.delete(*self.table.get_children())
        total = 0
        for entry in entries:
            total += entry.amount_cents if entry.kind == "Venda" else -entry.amount_cents
            self.table.insert("", "end", iid=str(entry.id), tags=(entry.kind,), values=(
                entry.entry_date, entry.kind, entry.category, entry.description,
                format_money(entry.amount_cents), entry.payment_method or "—", entry.supplier_or_customer or "—"))
        self.history_total.configure(text=f"{len(entries)} lançamentos · saldo do período {format_money(total)}")
        if hasattr(self,"ingredient_table"):
            self.refresh_catalogs()

    def delete_selected(self):
        selected = self.table.selection()
        if not selected:
            messagebox.showinfo("Histórico", "Selecione um lançamento primeiro.", parent=self)
            return
        if messagebox.askyesno("Excluir lançamento", "Excluir este registro do histórico?", parent=self):
            self.ledger.delete_entry(int(selected[0]))
            self.refresh()


def main():
    LedgerApp().mainloop()


if __name__ == "__main__":
    main()
