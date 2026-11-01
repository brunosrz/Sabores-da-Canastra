"""Interface desktop Tkinter do livro-caixa Sabores da Canastra."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk, simpledialog
from tkinter import filedialog
import json
import uuid
import sys

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
        if sys.platform == "win32":
            try:
                import ctypes
                ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("SaboresDaCanastra.Gestao")
            except (AttributeError, OSError):
                pass
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
        self._ensure_recipe_products()
        self._ensure_default_products()
        self.ledger.seed_bar_catalog()
        self.refresh()

    def _ensure_recipe_products(self,force=False):
        if not force and self.ledger.parameters().get("_recipe_products_seed_v1",{}).get("value")=="1":return
        existing_names={product["name"] for product in self.ledger.list_products()}
        for name in {recipe["product_name"] for recipe in self.ledger.list_recipes()}-existing_names:
            safe="".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-")
            self.ledger.upsert_product(product_id="recipe-"+safe,name=name,category="Salgados",
                notes="Defina o preço de venda antes de registrar vendas")
        self.ledger.upsert_parameter("_recipe_products_seed_v1","1","","Confirmado")

    def _ensure_default_products(self):
        params=self.ledger.parameters()
        if params.get("_catalog_seed_v1",{}).get("value")=="1":return
        defaults=[
            ("Bebidas","Refrigerante lata 350 ml","lata"),
            ("Bebidas","Energético lata","lata"),
            ("Bebidas","Água mineral 500 ml","un"),
            ("Doces","Brownie intenso","un"),
            ("Doces","Bolinho de banana, aveia e cacau","un"),
            ("Doces","Creme de morango com chocolate","un"),
            ("Doces","Creme de manga com chocolate","un"),
            ("Doces","Creme de maracujá com chocolate","un"),
            ("Molhos","Molho de pimenta artesanal","frasco"),
            ("Molhos","Maionese verde","porção"),
        ]
        names={p["name"] for p in self.ledger.list_products()}
        for category,name,unit in defaults:
            if name not in names:
                safe="".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-")
                self.ledger.upsert_product(product_id="default-"+safe,name=name,category=category,unit=unit,
                    notes="Produto inicial sem preço; edite preço e disponibilidade antes da venda")
        self.ledger.upsert_parameter("_catalog_seed_v1","1","","Confirmado")

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
        self.shell=shell
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
        self.exchange_toolbar=tk.Frame(shell,bg=BG);self.exchange_toolbar.pack(fill="x",pady=(0,7))

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
        left_shell=tk.Frame(content,bg=BG,width=355);left_shell.pack(side="left",fill="y",padx=(0,14));left_shell.pack_propagate(False)
        left_canvas=tk.Canvas(left_shell,bg=BG,width=350,highlightthickness=0)
        left_scroll=ttk.Scrollbar(left_shell,orient="vertical",command=left_canvas.yview);left_scroll.pack(side="right",fill="y")
        left_canvas.pack(side="left",fill="both",expand=True);left_canvas.configure(yscrollcommand=left_scroll.set)
        left = tk.Frame(left_canvas, bg=PANEL, padx=16, pady=16,
                        highlightbackground="#E5EAE5", highlightthickness=1)
        left_window=left_canvas.create_window((0,0),window=left,anchor="nw",width=330)
        left.bind("<Configure>",lambda _e:left_canvas.configure(scrollregion=left_canvas.bbox("all")))
        left_canvas.bind("<Configure>",lambda e:left_canvas.itemconfigure(left_window,width=e.width))
        left.bind("<Enter>",lambda _e:left_canvas.bind_all("<MouseWheel>",lambda ev:left_canvas.yview_scroll(int(-1*(ev.delta/120)),"units")))
        left.bind("<Leave>",lambda _e:left_canvas.unbind_all("<MouseWheel>"))
        tk.Label(left, text="Novo lançamento", bg=PANEL, fg=INK,
                 font=("Segoe UI", 15, "bold")).pack(anchor="w", pady=(0, 14))
        self.kind = tk.StringVar(value="Compra")
        self.entry_date = tk.StringVar(value=date.today().isoformat())
        self.category = tk.StringVar(value="Salgados")
        self.description = tk.StringVar()
        self.quantity = tk.StringVar()
        self.unit_price = tk.StringVar()
        self.amount = tk.StringVar()
        self.payment = tk.StringVar(value="Pix")
        self.counterparty = tk.StringVar()
        self.notes = tk.StringVar()
        self.sale_category=tk.StringVar(value="Todos")
        self.sale_product=tk.StringVar()
        self.sale_qty=tk.StringVar(value="1")
        self.sale_price=tk.StringVar()
        self.sale_cart=[]
        self._field(left, "Tipo", ttk.Combobox(left, textvariable=self.kind, values=["Compra", "Gasto"], state="readonly"))
        self._field(left, "Data (AAAA-MM-DD)", ttk.Entry(left, textvariable=self.entry_date))
        self.category_combo = ttk.Combobox(left, textvariable=self.category, values=self._suggestions("Venda"))
        self._field(left, "Categoria", self.category_combo)
        self.description_label=tk.Label(left,text="Descrição",bg=PANEL,fg=MUTED,font=("Segoe UI",9,"bold"));self.description_label.pack(anchor="w",pady=(0,4))
        self.description_entry=ttk.Entry(left,textvariable=self.description);self.description_entry.pack(fill="x",pady=(0,10),ipady=4)
        self.sale_items_frame=tk.Frame(left,bg=PANEL)
        tk.Label(self.sale_items_frame,text="Itens da venda",bg=PANEL,fg=INK,font=("Segoe UI",10,"bold")).pack(anchor="w")
        sell_select=tk.Frame(self.sale_items_frame,bg=PANEL);sell_select.pack(fill="x",pady=(5,4))
        self.sale_category_combo=ttk.Combobox(sell_select,textvariable=self.sale_category,values=["Todos","Salgados","Bebidas","Doces","Molhos","Outros"],state="readonly",width=12)
        self.sale_category_combo.pack(side="left",padx=(0,5));self.sale_category_combo.bind("<<ComboboxSelected>>",lambda _e:self.refresh_sale_products())
        self.sale_product_combo=ttk.Combobox(sell_select,textvariable=self.sale_product,state="readonly",width=22);self.sale_product_combo.pack(side="left",fill="x",expand=True)
        self.sale_product_combo.bind("<<ComboboxSelected>>",self.sale_product_selected)
        row=tk.Frame(self.sale_items_frame,bg=PANEL);row.pack(fill="x")
        ttk.Entry(row,textvariable=self.sale_qty,width=6).pack(side="left",padx=(0,5))
        ttk.Entry(row,textvariable=self.sale_price,width=10).pack(side="left",fill="x",expand=True)
        tk.Button(row,text="Adicionar",command=self.add_sale_item,bg=GREEN,fg="white",relief="flat",padx=8,pady=5).pack(side="left",padx=(5,0))
        tk.Button(self.sale_items_frame,text="+ Novo produto vendável",command=self.new_product_dialog,bg="#E8EDE8",fg=INK,relief="flat",padx=8,pady=5).pack(anchor="w",pady=(4,3))
        self.sale_cart_tree=ttk.Treeview(self.sale_items_frame,columns=("name","qty","price","total"),show="headings",height=4)
        for col,label,width in [("name","Produto",140),("qty","Qtd",40),("price","Unit.",70),("total","Total",75)]:self.sale_cart_tree.heading(col,text=label);self.sale_cart_tree.column(col,width=width)
        self.sale_cart_tree.pack(fill="x")
        tk.Button(self.sale_items_frame,text="Remover item selecionado",command=self.remove_sale_item,bg="#F8E9E6",fg=RED,relief="flat",padx=7,pady=4).pack(anchor="e",pady=(3,0))
        # Sales are registered in the dedicated `sabores-pdv` application.
        numbers = tk.Frame(left, bg=PANEL)
        numbers.pack(fill="x", pady=(0, 9))
        self._mini_field(numbers, "Quantidade", self.quantity, 11)
        self._mini_field(numbers, "Valor unitário", self.unit_price, 14)
        self.amount_entry=ttk.Entry(left,textvariable=self.amount)
        self._field(left, "Valor total (R$)", self.amount_entry)
        self._field(left, "Pagamento", ttk.Combobox(left, textvariable=self.payment,
                    values=["Pix", "Dinheiro", "Débito", "Crédito", "Transferência", "Outro"], state="readonly"))
        self._field(left, "Fornecedor / cliente", ttk.Entry(left, textvariable=self.counterparty))
        self._field(left, "Observação", ttk.Entry(left, textvariable=self.notes))
        self.kind.trace_add("write", self._kind_changed)
        self._kind_changed()
        self.sale_category.trace_add("write",lambda *_:self.refresh_sale_products())
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
        self.recipes_tab=tk.Frame(self.main_notebook,bg=BG,padx=28,pady=22)
        self.main_notebook.add(self.recipes_tab,text="  Receitas  ")
        self._build_costs_tab()
        self._build_production_tab()
        self._build_reports_tab()
        self._build_recipes_tab()
        self._build_data_exchange_controls()

    def _section_title(self, parent, title, subtitle):
        tk.Label(parent, text=title, bg=BG, fg=INK, font=("Segoe UI", 20, "bold")).pack(anchor="w")
        tk.Label(parent, text=subtitle, bg=BG, fg=MUTED, font=("Segoe UI", 10)).pack(anchor="w", pady=(3, 18))

    def _build_data_exchange_controls(self):
        bar=self.exchange_toolbar
        tk.Label(bar,text="Dados em JSON",bg=BG,fg=MUTED,font=("Segoe UI",9)).pack(side="left")
        tk.Button(bar,text="Exportar JSON",command=self.export_json,bg="#E8EDE8",fg=INK,relief="flat",padx=9,pady=5).pack(side="left",padx=3)
        tk.Button(bar,text="Importar JSON",command=self.import_json,bg="#E8EDE8",fg=INK,relief="flat",padx=9,pady=5).pack(side="left",padx=3)

    def export_json(self):
        path=filedialog.asksaveasfilename(parent=self,title="Exportar catálogo e configurações",defaultextension=".json",filetypes=[("JSON","*.json")],initialfile="sabores-config-v1.json")
        if not path:return
        try:
            with open(path,"w",encoding="utf-8") as f:json.dump(self.ledger.export_configuration(),f,ensure_ascii=False,indent=2)
            messagebox.showinfo("Exportação concluída","Catálogo, receitas, mix e premissas exportados. Lançamentos financeiros não são incluídos.",parent=self)
        except Exception as exc:messagebox.showerror("Exportação",str(exc),parent=self)

    def import_json(self):
        path=filedialog.askopenfilename(parent=self,title="Importar catálogo e configurações",filetypes=[("JSON","*.json")])
        if not path:return
        if not messagebox.askyesno("Importar JSON","O arquivo vai inserir/atualizar ingredientes, receitas, produtos, mix e premissas. O ledger de vendas/compras/gastos será preservado. Continuar?",parent=self):return
        try:
            with open(path,encoding="utf-8") as f:payload=json.load(f)
            result=self.ledger.import_configuration(payload)
            self._ensure_recipe_products(force=True);self.refresh();self.refresh_catalogs();self.refresh_sale_products()
            messagebox.showinfo("Importação concluída",f"{result['ingredients']} ingredientes · {result['recipes']} receitas · {result['products']} produtos. Ledger preservado.",parent=self)
        except Exception as exc:messagebox.showerror("Importação cancelada",str(exc),parent=self)

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
        self.ingredient_category = tk.StringVar(value="Ingrediente")
        for label, var in [("Ingrediente",self.ingredient_name),("Unidade base (g/ml/un)",self.ingredient_unit),
                           ("Quantidade no pacote",self.ingredient_pack_qty),("Preço pacote (R$)",self.ingredient_price),
                           ("Fornecedor",self.ingredient_supplier),("Fonte / URL",self.ingredient_source)]:
            self._field(form,label,ttk.Entry(form,textvariable=var))
        self._field(form,"Categoria",ttk.Combobox(form,textvariable=self.ingredient_category,
                    values=["Ingrediente","Laticínios","Carnes","Hortifruti","Mercearia","Temperos","Outros"]))
        self._field(form,"Status do preço",ttk.Combobox(form,textvariable=self.ingredient_status,
                    values=["Confirmado","Estimado","Pendente","Desatualizado"],state="readonly"))
        tk.Button(form,text="Salvar ingrediente",command=self.save_ingredient,bg=GREEN,fg="white",relief="flat",
                  font=("Segoe UI",10,"bold"),padx=12,pady=10).pack(fill="x",pady=(5,0))
        listing = tk.Frame(body,bg=PANEL,padx=18,pady=18,highlightbackground="#E5EAE5",highlightthickness=1)
        listing.pack(side="left",fill="both",expand=True)
        list_header=tk.Frame(listing,bg=PANEL);list_header.pack(fill="x",pady=(0,10))
        tk.Label(list_header,text="Ingredientes",bg=PANEL,fg=INK,font=("Segoe UI",14,"bold")).pack(side="left")
        self.ingredient_count=tk.Label(list_header,text="",bg=PANEL,fg=MUTED,font=("Segoe UI",9));self.ingredient_count.pack(side="right")
        filters=tk.Frame(listing,bg=PANEL);filters.pack(fill="x",pady=(0,10))
        tk.Label(filters,text="Buscar",bg=PANEL,fg=MUTED,font=("Segoe UI",8,"bold")).pack(side="left",padx=(0,5))
        self.ingredient_search=tk.StringVar();search=ttk.Entry(filters,textvariable=self.ingredient_search,width=25);search.pack(side="left",fill="x",expand=True)
        tk.Label(filters,text="Status",bg=PANEL,fg=MUTED,font=("Segoe UI",8,"bold")).pack(side="left",padx=(10,5))
        self.ingredient_status_filter=tk.StringVar(value="Todos")
        ttk.Combobox(filters,textvariable=self.ingredient_status_filter,values=["Todos","Confirmado","Estimado","Pendente","Desatualizado"],state="readonly",width=14).pack(side="left")
        tk.Label(filters,text="Categoria",bg=PANEL,fg=MUTED,font=("Segoe UI",8,"bold")).pack(side="left",padx=(10,5))
        self.ingredient_category_filter=tk.StringVar(value="Todas")
        ttk.Combobox(filters,textvariable=self.ingredient_category_filter,values=["Todas","Ingrediente","Laticínios","Carnes","Hortifruti","Mercearia","Temperos","Outros"],state="readonly",width=14).pack(side="left")
        actions=tk.Frame(listing,bg=PANEL);actions.pack(fill="x",pady=(0,8))
        tk.Button(actions,text="Editar selecionado",command=self.edit_selected_ingredient,bg=GREEN,fg="white",relief="flat",padx=11,pady=7).pack(side="left")
        tk.Button(actions,text="Remover selecionado",command=self.remove_selected_ingredient,bg="#F8E9E6",fg=RED,relief="flat",padx=11,pady=7).pack(side="left",padx=8)
        tk.Button(actions,text="Limpar filtros",command=self.clear_ingredient_filters,bg="#E8EDE8",fg=INK,relief="flat",padx=11,pady=7).pack(side="left",padx=8)
        self.ingredient_table = ttk.Treeview(listing,columns=("name","unit","pack","price","supplier","status"),show="headings")
        for col,label,width in [("name","Ingrediente",210),("unit","Unid.",65),("pack","Pacote",90),("price","Preço",105),("supplier","Fornecedor",150),("status","Status",110)]:
            self.ingredient_table.heading(col,text=label); self.ingredient_table.column(col,width=width)
        table_frame=tk.Frame(listing,bg=PANEL);table_frame.pack(fill="both",expand=True)
        self.ingredient_table.pack(in_=table_frame,side="left",fill="both",expand=True)
        ingredient_scroll=ttk.Scrollbar(table_frame,orient="vertical",command=self.ingredient_table.yview);ingredient_scroll.pack(side="right",fill="y")
        self.ingredient_table.configure(yscrollcommand=ingredient_scroll.set)
        self.ingredient_table.bind("<Double-1>",lambda _event:self.edit_selected_ingredient())
        self.ingredient_table.bind("<Return>",lambda _event:self.edit_selected_ingredient())
        self.ingredient_search.trace_add("write",lambda *_:self.refresh_catalogs())
        self.ingredient_status_filter.trace_add("write",lambda *_:self.refresh_catalogs())
        self.ingredient_category_filter.trace_add("write",lambda *_:self.refresh_catalogs())
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

    def _build_recipes_tab(self):
        self._section_title(self.recipes_tab,"Receitas e produtos","Cadastre os produtos que você vende e configure os ingredientes e quantidades de cada receita.")
        bar=tk.Frame(self.recipes_tab,bg=PANEL,padx=12,pady=9);bar.pack(fill="x",pady=(0,12))
        tk.Label(bar,text="Produto vendável (salgados, bebidas, doces, molhos e outros)",bg=PANEL,fg=INK,font=("Segoe UI",10,"bold")).pack(side="left")
        tk.Button(bar,text="+ Novo produto",command=self.new_product_dialog,bg=GREEN,fg="white",relief="flat",padx=12,pady=7).pack(side="right")
        body=tk.Frame(self.recipes_tab,bg=BG);body.pack(fill="both",expand=True)
        editor=tk.Frame(body,bg=PANEL,padx=16,pady=15,highlightbackground="#E5EAE5",highlightthickness=1);editor.pack(side="left",fill="y",padx=(0,14))
        tk.Label(editor,text="Ficha técnica",bg=PANEL,fg=INK,font=("Segoe UI",14,"bold")).pack(anchor="w",pady=(0,10))
        self.recipe_id_var=tk.StringVar();self.recipe_name_var=tk.StringVar();self.recipe_version_var=tk.StringVar(value="E")
        self.recipe_yield_var=tk.StringVar(value="1");self.recipe_source_var=tk.StringVar();self.recipe_instruction_var=tk.StringVar()
        for label,var in [("ID da receita",self.recipe_id_var),("Produto",self.recipe_name_var),("Rendimento do lote",self.recipe_yield_var),("Fonte",self.recipe_source_var),("Preparo / notas",self.recipe_instruction_var)]:
            self._field(editor,label,ttk.Entry(editor,textvariable=var))
        self._field(editor,"Versão",ttk.Combobox(editor,textvariable=self.recipe_version_var,values=["E","R","Única"],state="readonly"))
        linebox=tk.LabelFrame(editor,text="Ingrediente para adicionar",bg=PANEL,fg=INK,padx=8,pady=7)
        linebox.pack(fill="x",pady=(3,8))
        self.recipe_ingredient_var=tk.StringVar();self.recipe_line_qty_var=tk.StringVar(value="0");self.recipe_line_unit_var=tk.StringVar(value="g");self.recipe_stage_var=tk.StringVar(value="Recheio")
        self.recipe_ingredient_combo=ttk.Combobox(linebox,textvariable=self.recipe_ingredient_var,state="readonly",width=30);self.recipe_ingredient_combo.pack(fill="x",pady=3)
        line_row=tk.Frame(linebox,bg=PANEL);line_row.pack(fill="x",pady=3)
        ttk.Entry(line_row,textvariable=self.recipe_line_qty_var,width=9).pack(side="left")
        ttk.Combobox(line_row,textvariable=self.recipe_line_unit_var,values=["g","ml","un"],state="readonly",width=6).pack(side="left",padx=4)
        ttk.Combobox(line_row,textvariable=self.recipe_stage_var,values=["Massa","Recheio","Cobertura","Montagem","Outro"],width=13).pack(side="left",padx=4)
        tk.Button(linebox,text="Adicionar ingrediente",command=self.add_recipe_line,bg="#E8EDE8",fg=INK,relief="flat",padx=8,pady=5).pack(anchor="e")
        tk.Button(editor,text="Nova ficha",command=self.clear_recipe_editor,bg="#E8EDE8",fg=INK,relief="flat",padx=11,pady=7).pack(fill="x",pady=(4,5))
        tk.Button(editor,text="Salvar ficha técnica",command=self.save_recipe_editor,bg=GREEN,fg="white",relief="flat",padx=11,pady=9).pack(fill="x")
        right=tk.Frame(body,bg=PANEL,padx=16,pady=15,highlightbackground="#E5EAE5",highlightthickness=1);right.pack(side="left",fill="both",expand=True)
        tk.Label(right,text="Produtos cadastrados",bg=PANEL,fg=INK,font=("Segoe UI",14,"bold")).pack(anchor="w")
        self.product_table=ttk.Treeview(right,columns=("name","category","price","active"),show="headings",height=8)
        for col,label,width in [("name","Produto",260),("category","Categoria",120),("price","Preço venda",110),("active","Ativo",60)]:self.product_table.heading(col,text=label);self.product_table.column(col,width=width)
        self.product_table.pack(fill="x",pady=(8,12));self.product_table.bind("<Double-1>",self.edit_product_dialog)
        product_actions=tk.Frame(right,bg=PANEL);product_actions.pack(fill="x",pady=(0,10))
        tk.Button(product_actions,text="Editar produto selecionado",command=self.edit_product_dialog,bg="#E8EDE8",fg=INK,relief="flat",padx=9,pady=6).pack(side="left")
        tk.Button(product_actions,text="Novo produto",command=self.new_product_dialog,bg=GREEN,fg="white",relief="flat",padx=9,pady=6).pack(side="left",padx=7)
        tk.Label(right,text="Receitas",bg=PANEL,fg=INK,font=("Segoe UI",14,"bold")).pack(anchor="w")
        self.recipe_list_table=ttk.Treeview(right,columns=("id","product","version","yield","cost"),show="headings")
        for col,label,width in [("id","ID",145),("product","Produto",230),("version","Versão",80),("yield","Rendimento",100),("cost","Custo/lote",110)]:self.recipe_list_table.heading(col,text=label);self.recipe_list_table.column(col,width=width)
        self.recipe_list_table.pack(fill="both",expand=True,pady=(8,4));self.recipe_list_table.bind("<<TreeviewSelect>>",self.load_recipe_editor)
        tk.Button(right,text="Remover receita selecionada",command=self.remove_selected_recipe,bg="#F8E9E6",fg=RED,relief="flat",padx=9,pady=6).pack(anchor="e")
        self.recipe_lines=[]
        self.recipe_line_table=ttk.Treeview(editor,columns=("ingredient","qty","unit","stage"),show="headings",height=8)
        for col,label,width in [("ingredient","Ingrediente",150),("qty","Qtd",55),("unit","Unid.",45),("stage","Etapa",90)]:self.recipe_line_table.heading(col,text=label);self.recipe_line_table.column(col,width=width)
        self.recipe_line_table.pack(fill="x",pady=(0,5))
        tk.Button(editor,text="Remover linha selecionada",command=self.remove_recipe_line,bg="#F8E9E6",fg=RED,relief="flat",padx=7,pady=4).pack(anchor="e",pady=(0,6))
        self.refresh_recipe_products()

    def refresh_recipe_products(self):
        if not hasattr(self,"recipe_list_table"):return
        self._ensure_recipe_products()
        for item in self.product_table.get_children():self.product_table.delete(item)
        for product in self.ledger.list_products():
            price="—" if product["sale_price_cents"] is None else format_money(product["sale_price_cents"])
            self.product_table.insert("","end",iid="product:"+product["product_id"],values=(product["name"],product["category"],price,"Sim" if product["active"] else "Não"))
        for item in self.recipe_list_table.get_children():self.recipe_list_table.delete(item)
        for recipe in self.ledger.list_recipes():
            cost=self.ledger.recipe_cost(recipe["recipe_id"])["batch_cost_cents"]
            self.recipe_list_table.insert("","end",iid=recipe["recipe_id"],values=(recipe["recipe_id"],recipe["product_name"],recipe["version"],recipe["yield_units"],"Pendente" if cost is None else format_money(cost)))
        self.recipe_ingredient_combo.configure(values=[i["name"] for i in self.ledger.list_ingredients()])
        if self.ledger.list_ingredients() and not self.recipe_ingredient_var.get():self.recipe_ingredient_var.set(self.ledger.list_ingredients()[0]["name"])
        self.refresh_sale_products()

    def add_recipe_line(self):
        name=self.recipe_ingredient_var.get()
        try:qty=Decimal(self.recipe_line_qty_var.get().replace(",","."))
        except InvalidOperation:messagebox.showerror("Receita","Quantidade inválida",parent=self);return
        if not name or qty<=0:messagebox.showerror("Receita","Escolha ingrediente e uma quantidade maior que zero",parent=self);return
        unit=self.recipe_line_unit_var.get()
        ingredient=next((x for x in self.ledger.list_ingredients() if x["name"]==name),None)
        if ingredient and ingredient["base_unit"]!=unit:
            messagebox.showerror("Unidade incompatível",f"{name} é cadastrado em {ingredient['base_unit']}; use a mesma unidade.",parent=self);return
        self.recipe_lines.append({"ingredient_name":name,"quantity":str(qty),"unit":unit,"stage":self.recipe_stage_var.get()})
        self.render_recipe_lines()

    def render_recipe_lines(self):
        if not hasattr(self,"recipe_line_table"):return
        for item in self.recipe_line_table.get_children():self.recipe_line_table.delete(item)
        for index,line in enumerate(self.recipe_lines):self.recipe_line_table.insert("","end",iid=str(index),values=(line["ingredient_name"],line["quantity"],line["unit"],line["stage"]))

    def remove_recipe_line(self):
        selected=self.recipe_line_table.selection()
        if selected:self.recipe_lines.pop(int(selected[0]));self.render_recipe_lines()

    def clear_recipe_editor(self):
        self.recipe_id_var.set("");self.recipe_name_var.set("");self.recipe_version_var.set("E");self.recipe_yield_var.set("1");self.recipe_source_var.set("");self.recipe_instruction_var.set("");self.recipe_lines=[];self.render_recipe_lines()

    def load_recipe_editor(self,_event=None):
        selected=self.recipe_list_table.selection()
        if not selected:return
        recipe=self.ledger.recipe(selected[0])
        if not recipe:return
        self.recipe_id_var.set(recipe["recipe_id"]);self.recipe_name_var.set(recipe["product_name"]);self.recipe_version_var.set(recipe["version"])
        self.recipe_yield_var.set(str(recipe["yield_units"]));self.recipe_source_var.set(recipe["source"] or "");self.recipe_instruction_var.set(recipe["instructions"] or "")
        self.recipe_lines=list(recipe["lines"]);self.render_recipe_lines()

    def save_recipe_editor(self):
        try:
            name=self.recipe_name_var.get().strip();version=self.recipe_version_var.get();rid=self.recipe_id_var.get().strip()
            if not rid:rid="".join(ch.upper() if ch.isalnum() else "_" for ch in name).strip("_")+"_"+version
            self.ledger.replace_recipe(recipe_id=rid,product_name=name,version=version,yield_units=int(self.recipe_yield_var.get()),
                source=self.recipe_source_var.get().strip() or None,instructions=self.recipe_instruction_var.get().strip() or None,
                lines=[(x["ingredient_name"],x["quantity"],x["unit"],x["stage"]) for x in self.recipe_lines])
        except Exception as exc:messagebox.showerror("Ficha técnica",str(exc),parent=self);return
        self.clear_recipe_editor();self.refresh_recipe_products();self.refresh_catalogs()

    def remove_selected_recipe(self):
        selected=self.recipe_list_table.selection()
        if selected and messagebox.askyesno("Remover receita","Remover a ficha técnica selecionada? O produto vendável será mantido.",parent=self):
            self.ledger.delete_recipe(selected[0]);self.clear_recipe_editor();self.refresh_recipe_products();self.refresh_catalogs()

    def new_product_dialog(self):
        self._product_dialog()

    def edit_product_dialog(self,event=None):
        row=self.product_table.identify_row(event.y) if event else (self.product_table.selection()[0] if self.product_table.selection() else None)
        if not row:return
        product_id=row.removeprefix("product:")
        product=next((p for p in self.ledger.list_products() if p["product_id"]==product_id),None)
        if product:self._product_dialog(product)

    def _product_dialog(self,product=None):
        dialog=tk.Toplevel(self);dialog.title("Produto vendável" if not product else "Editar produto");dialog.transient(self);dialog.grab_set();dialog.configure(bg=BG)
        box=tk.Frame(dialog,bg=PANEL,padx=22,pady=20);box.pack(fill="both",expand=True)
        tk.Label(box,text="Produto vendável",bg=PANEL,fg=INK,font=("Segoe UI",16,"bold")).pack(anchor="w",pady=(0,12))
        name=tk.StringVar(value=product["name"] if product else "");category=tk.StringVar(value=product["category"] if product else "Salgados")
        price=tk.StringVar(value="" if not product or product["sale_price_cents"] is None else str(Decimal(product["sale_price_cents"])/100))
        unit=tk.StringVar(value=product["unit"] if product else "un");active=tk.BooleanVar(value=bool(product["active"]) if product else True)
        barcode=tk.StringVar(value=product.get("barcode") or "" if product else "")
        auxiliary_code=tk.StringVar(value=product.get("auxiliary_code") or "" if product else "")
        self._field(box,"Nome",ttk.Entry(box,textvariable=name));self._field(box,"Categoria",ttk.Combobox(box,textvariable=category,values=["Salgados","Bebidas","Doces","Molhos","Porções","Lanches","Pizzas","Outros"]))
        self._field(box,"Código de barras",ttk.Entry(box,textvariable=barcode));self._field(box,"Código auxiliar",ttk.Entry(box,textvariable=auxiliary_code))
        self._field(box,"Preço de venda (R$)",ttk.Entry(box,textvariable=price));self._field(box,"Unidade",ttk.Combobox(box,textvariable=unit,values=["un","lata","garrafa","porção","frasco"]))
        ttk.Checkbutton(box,text="Ativo para lançamento de vendas",variable=active).pack(anchor="w",pady=6)
        def save():
            try:
                cents=parse_money(price.get()) if price.get().strip() else None
                pid=product["product_id"] if product else "product-"+uuid.uuid4().hex[:12]
                self.ledger.upsert_product(product_id=pid,name=name.get(),category=category.get(),unit=unit.get(),sale_price_cents=cents,
                    barcode=barcode.get(),auxiliary_code=auxiliary_code.get(),active=active.get())
            except Exception as exc:messagebox.showerror("Produto",str(exc),parent=dialog);return
            dialog.destroy();self.refresh_recipe_products()
        buttons=tk.Frame(box,bg=PANEL);buttons.pack(fill="x",pady=(14,0))
        if product:tk.Button(buttons,text="Remover",command=lambda:self.delete_product_confirm(product,dialog),bg="#F8E9E6",fg=RED,relief="flat",padx=10,pady=7).pack(side="left")
        tk.Button(buttons,text="Salvar",command=save,bg=GREEN,fg="white",relief="flat",padx=14,pady=8).pack(side="right")

    def delete_product_confirm(self,product,dialog):
        if messagebox.askyesno("Remover produto",f"Remover {product['name']} do catálogo?",parent=dialog):
            self.ledger.delete_product(product["product_id"]);dialog.destroy();self.refresh_recipe_products()

    def save_ingredient(self):
        try:
            pack_price=parse_money(self.ingredient_price.get()) if self.ingredient_price.get().strip() else None
            self.ledger.upsert_ingredient(name=self.ingredient_name.get(),base_unit=self.ingredient_unit.get(),
                pack_quantity=self.ingredient_pack_qty.get(),pack_price_cents=pack_price,
                supplier=self.ingredient_supplier.get(),price_status=self.ingredient_status.get(),source=self.ingredient_source.get(),
                notes="categoria:"+self.ingredient_category.get())
        except ValueError as exc:
            messagebox.showerror("Ingrediente",str(exc),parent=self);return
        self.ingredient_name.set("");self.ingredient_price.set("");self.ingredient_supplier.set("");self.ingredient_source.set("")
        self.refresh_catalogs()

    def edit_selected_ingredient(self):
        selection=self.ingredient_table.selection()
        if not selection:
            messagebox.showinfo("Ingredientes","Selecione um ingrediente na lista para editar.",parent=self);return
        item=self.ingredient_table.item(selection[0],"values")
        name=item[0]
        ingredient=next((row for row in self.ledger.list_ingredients() if row["name"]==name),None)
        if not ingredient:return
        self._ingredient_editor(ingredient)

    def clear_ingredient_filters(self):
        self.ingredient_search.set("");self.ingredient_status_filter.set("Todos");self.ingredient_category_filter.set("Todas")

    def remove_selected_ingredient(self):
        selection=self.ingredient_table.selection()
        if not selection:
            messagebox.showinfo("Ingredientes","Selecione um ingrediente primeiro.",parent=self);return
        name=self.ingredient_table.item(selection[0],"values")[0]
        if not messagebox.askyesno("Remover ingrediente",f"Remover {name} do catálogo?",parent=self):return
        try:self.ledger.delete_ingredient(name)
        except ValueError as exc:messagebox.showerror("Ingrediente em uso",str(exc),parent=self);return
        self.refresh_catalogs()

    def _ingredient_editor(self,ingredient):
        dialog=tk.Toplevel(self);dialog.title(f"Editar ingrediente · {ingredient['name']}");dialog.transient(self);dialog.grab_set();dialog.configure(bg=BG);dialog.resizable(False,False)
        outer=tk.Frame(dialog,bg=PANEL,padx=22,pady=20);outer.pack(fill="both",expand=True)
        tk.Label(outer,text="Editar ingrediente",bg=PANEL,fg=INK,font=("Segoe UI",16,"bold")).pack(anchor="w")
        tk.Label(outer,text="Atualize embalagem e preço. Use fonte e data ao confirmar uma cotação.",bg=PANEL,fg=MUTED,wraplength=440,justify="left").pack(anchor="w",pady=(4,14))
        fields={k:tk.StringVar(value=v or "") for k,v in {
            "name":ingredient["name"],"base_unit":ingredient["base_unit"],"pack_quantity":ingredient["pack_quantity"],
            "price":("" if ingredient["pack_price_cents"] is None else f"{Decimal(ingredient['pack_price_cents'])/100:.2f}"),
            "supplier":ingredient["supplier"],"price_date":ingredient["price_date"],"status":ingredient["price_status"],
            "source":ingredient["source"],"category":self._category_of(ingredient)}.items()}
        specs=[("Ingrediente","name",False),("Unidade base (g/ml/un)","base_unit",False),("Quantidade na embalagem","pack_quantity",False),
               ("Preço da embalagem (R$)","price",False),("Fornecedor","supplier",False),("Data da cotação (AAAA-MM-DD)","price_date",False),
               ("Fonte / URL","source",False),("Categoria","category",True),("Status do preço","status",True)]
        for label,key,choice in specs:
            row=tk.Frame(outer,bg=PANEL);row.pack(fill="x",pady=4)
            tk.Label(row,text=label,bg=PANEL,fg=MUTED,width=29,anchor="w",font=("Segoe UI",9,"bold")).pack(side="left")
            if choice:
                options=("Confirmado","Estimado","Pendente","Desatualizado") if key=="status" else ("Ingrediente","Laticínios","Carnes","Hortifruti","Mercearia","Temperos","Outros")
                ttk.Combobox(row,textvariable=fields[key],values=options,state="readonly",width=30).pack(side="left")
            else:ttk.Entry(row,textvariable=fields[key],width=34).pack(side="left")
        buttons=tk.Frame(outer,bg=PANEL);buttons.pack(fill="x",pady=(16,0))
        tk.Button(buttons,text="Cancelar",command=dialog.destroy,bg="#E8EDE8",fg=INK,relief="flat",padx=14,pady=9).pack(side="right")
        def save():
            try:
                price=parse_money(fields["price"].get()) if fields["price"].get().strip() else None
                if not fields["name"].get().strip() or Decimal(fields["pack_quantity"].get())<=0:raise ValueError("Nome e quantidade positiva são obrigatórios")
                status=fields["status"].get()
                if price is None and status=="Confirmado":raise ValueError("Uma cotação confirmada precisa ter preço")
                category_note="categoria:"+fields["category"].get()
                with self.ledger._connect() as db:
                    db.execute("UPDATE ingredients SET name=?,base_unit=?,pack_quantity=?,pack_price_cents=?,supplier=?,price_date=?,price_status=?,source=?,notes=? WHERE name=?",
                        (fields["name"].get().strip(),fields["base_unit"].get().strip(),fields["pack_quantity"].get(),price,
                         fields["supplier"].get().strip() or None,fields["price_date"].get().strip() or None,status,
                         fields["source"].get().strip() or None,category_note,ingredient["name"]))
            except Exception as exc:
                messagebox.showerror("Ingrediente",str(exc),parent=dialog);return
            dialog.destroy();self.refresh_catalogs()
        tk.Button(buttons,text="Salvar alterações",command=save,bg=GREEN,fg="white",relief="flat",padx=14,pady=9).pack(side="right",padx=(0,8))

    @staticmethod
    def _category_of(ingredient):
        notes=ingredient.get("notes") or ""
        return notes.split("categoria:",1)[1].split(";",1)[0] if "categoria:" in notes else "Ingrediente"

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
        for tree in [self.recipe_table,self.mix_table]:tree.delete(*tree.get_children())
        items=self.ledger.list_ingredients()
        query=self.ingredient_search.get().strip().casefold() if hasattr(self,"ingredient_search") else ""
        status_filter=self.ingredient_status_filter.get() if hasattr(self,"ingredient_status_filter") else "Todos"
        category_filter=self.ingredient_category_filter.get() if hasattr(self,"ingredient_category_filter") else "Todas"
        visible=[]
        for item in items:
            category=self._category_of(item)
            haystack=" ".join(str(item.get(key) or "") for key in ("name","base_unit","supplier","source","notes")).casefold()
            if query and query not in haystack:continue
            if status_filter!="Todos" and item["price_status"]!=status_filter:continue
            if category_filter!="Todas" and category!=category_filter:continue
            visible.append(item)
        current_selection=self.ingredient_table.selection()
        for iid in self.ingredient_table.get_children():self.ingredient_table.delete(iid)
        for item in visible:
            price="Pendente" if item["pack_price_cents"] is None else format_money(item["pack_price_cents"])
            self.ingredient_table.insert("","end",iid=item["name"],values=(item["name"],item["base_unit"],item["pack_quantity"],price,item["supplier"] or "—",item["price_status"]))
        self.ingredient_count.configure(text=f"{len(visible)} de {len(items)} ingredientes")
        if current_selection and self.ingredient_table.exists(current_selection[0]):self.ingredient_table.selection_set(current_selection[0])
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
        if kind=="Venda":
            if not self.sale_items_frame.winfo_manager():self.sale_items_frame.pack(fill="x",pady=(0,8),before=self.amount_entry if hasattr(self,"amount_entry") else None)
        else:self.sale_items_frame.pack_forget()
        self.refresh_sale_products()

    def refresh_sale_products(self):
        if not hasattr(self,"sale_product_combo"):return
        products=self.ledger.list_products(active_only=True)
        category=self.sale_category.get()
        filtered=[p for p in products if category=="Todos" or p["category"]==category]
        self.sale_product_combo.configure(values=[p["name"] for p in filtered])
        if self.sale_product.get() not in {p["name"] for p in filtered}:
            self.sale_product.set(filtered[0]["name"] if filtered else "")
        self.sale_product_selected()

    def sale_product_selected(self,_event=None):
        if not hasattr(self,"sale_price"):return
        product=next((p for p in self.ledger.list_products(active_only=True) if p["name"]==self.sale_product.get()),None)
        self.sale_price.set("" if not product or product["sale_price_cents"] is None else f"{Decimal(product['sale_price_cents'])/100:.2f}".replace(".",","))

    def add_sale_item(self):
        product=next((p for p in self.ledger.list_products(active_only=True) if p["name"]==self.sale_product.get()),None)
        if not product:messagebox.showerror("Venda","Cadastre ou selecione um produto vendável.",parent=self);return
        try:
            quantity=Decimal(self.sale_qty.get().replace(",","."));unit_cents=parse_money(self.sale_price.get())
            if quantity<=0:raise ValueError("Quantidade deve ser maior que zero")
        except (ValueError,InvalidOperation) as exc:messagebox.showerror("Venda",str(exc),parent=self);return
        total=int((quantity*unit_cents).quantize(Decimal("1"),rounding=ROUND_HALF_UP))
        self.sale_cart.append({"product":product,"quantity":quantity,"unit_price_cents":unit_cents,"amount_cents":total})
        self.render_sale_cart();self.sale_qty.set("1")

    def render_sale_cart(self):
        for row in self.sale_cart_tree.get_children():self.sale_cart_tree.delete(row)
        for index,line in enumerate(self.sale_cart):self.sale_cart_tree.insert("","end",iid=str(index),values=(line["product"]["name"],str(line["quantity"]),format_money(line["unit_price_cents"]),format_money(line["amount_cents"])))

    def remove_sale_item(self):
        selection=self.sale_cart_tree.selection()
        if selection:self.sale_cart.pop(int(selection[0]));self.render_sale_cart()

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
            if self.kind.get()=="Venda":
                if not self.sale_cart:raise ValueError("Adicione ao menos um salgado, refrigerante, doce ou molho à venda")
                date.fromisoformat(self.entry_date.get().strip())
                group_id=uuid.uuid4().hex
                for line in self.sale_cart:
                    product=line["product"]
                    self.ledger.add_entry(entry_date=self.entry_date.get().strip(),kind="Venda",category=product["category"],
                        description=product["name"],quantity=str(line["quantity"]),unit_price_cents=line["unit_price_cents"],
                        amount_cents=line["amount_cents"],payment_method=self.payment.get(),
                        supplier_or_customer=self.counterparty.get(),notes=(self.notes.get().strip()+f" [sale_group:{group_id}]").strip())
                self.sale_cart.clear();self.render_sale_cart();self.description.set("");self.quantity.set("");self.unit_price.set("");self.amount.set("");self.counterparty.set("");self.notes.set("")
                self.refresh();return
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
