"""Inspeção, validação e enriquecimento não destrutivo da planilha existente."""

from __future__ import annotations

from datetime import date
from pathlib import Path
import shutil

from openpyxl import load_workbook
from openpyxl.workbook.properties import CalcProperties
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

from .finance import D, baseline_finance, card_fee_rate

BLUE = "1F4E78"
LIGHT_BLUE = "D9EAF7"
YELLOW = "FFF2CC"
GREEN = "E2F0D9"
RED = "FCE4D6"
WHITE = "FFFFFF"


def inspect_workbook(path: str | Path) -> dict:
    wb = load_workbook(path, data_only=False)
    result = {"sheets": [], "formulas": 0, "charts": 0}
    for ws in wb.worksheets:
        formulas = sum(1 for row in ws.iter_rows() for cell in row if cell.data_type == "f")
        result["sheets"].append({"name": ws.title, "rows": ws.max_row,
                                 "columns": ws.max_column, "formulas": formulas,
                                 "freeze_panes": ws.freeze_panes,
                                 "tables": list(ws.tables),
                                 "validations": len(ws.data_validations.dataValidation),
                                 "charts": len(ws._charts)})
        result["formulas"] += formulas
        result["charts"] += len(ws._charts)
    return result


def validate_workbook(path: str | Path) -> list[str]:
    wb = load_workbook(path, data_only=False)
    errors: list[str] = []
    required = {"Painel", "Parametros", "Insumos", "Fichas", "Composicao", "Mix diario", "Fontes", "Compras"}
    missing = required - set(wb.sheetnames)
    if missing:
        errors.append(f"Abas ausentes: {', '.join(sorted(missing))}")
        return errors
    params = wb["Parametros"]
    for row in range(6, 40):
        value = params.cell(row, 2).value
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
            errors.append(f"Parametros!B{row}: valor numérico inválido")
    try:
        share = card_fee_rate(params["B18"].value, params["B19"].value,
                              params["B20"].value, params["B21"].value)
        if share < 0:
            errors.append("Taxa ponderada não pode ser negativa")
    except ValueError as exc:
        errors.append(str(exc))
    if params["B38"].value is not None and params["B38"].value >= 1:
        errors.append("Percentual de perdas de refrigerante deve ser menor que 100%")
    insumos = wb["Insumos"]
    names = set()
    for row in range(5, insumos.max_row + 1):
        name = insumos.cell(row, 1).value
        if not name:
            continue
        names.add(name)
        quantity, price = insumos.cell(row, 3).value, insumos.cell(row, 4).value
        if not isinstance(quantity, (int, float)) or quantity <= 0:
            errors.append(f"Insumos linha {row}: quantidade da embalagem inválida")
        if not isinstance(price, (int, float)) or price < 0:
            errors.append(f"Insumos linha {row}: preço deve ser não negativo")
    recipes = set()
    fichas = wb["Fichas"]
    for row in range(5, fichas.max_row + 1):
        recipe_id = fichas.cell(row, 1).value
        if recipe_id:
            recipes.add(recipe_id)
            if not isinstance(fichas.cell(row, 5).value, (int, float)) or fichas.cell(row, 5).value <= 0:
                errors.append(f"Fichas linha {row}: rendimento deve ser maior que zero")
    composition = wb["Composicao"]
    for row in range(5, composition.max_row + 1):
        if not composition.cell(row, 1).value:
            continue
        if composition.cell(row, 1).value not in recipes:
            errors.append(f"Composicao linha {row}: ID de receita inexistente")
        if composition.cell(row, 3).value not in names:
            errors.append(f"Composicao linha {row}: ingrediente não cadastrado: {composition.cell(row, 3).value}")
        if not isinstance(composition.cell(row, 4).value, (int, float)) or composition.cell(row, 4).value < 0:
            errors.append(f"Composicao linha {row}: quantidade inválida")
    mix = wb["Mix diario"]
    mix_total = sum((mix.cell(row, 3).value or 0) for row in range(5, 13))
    if mix_total != params["B7"].value:
        errors.append(f"Mix diário soma {mix_total}; parâmetro de venda é {params['B7'].value}")
    return errors


def _style_header(ws, row: int, start_col: int, end_col: int) -> None:
    for col in range(start_col, end_col + 1):
        cell = ws.cell(row, col)
        cell.fill = PatternFill("solid", fgColor=BLUE)
        cell.font = Font(color=WHITE, bold=True)
        cell.alignment = Alignment(vertical="center", wrap_text=True)


def _add_price_research(wb) -> None:
    title = "Pesquisa de preços"
    if title in wb.sheetnames:
        del wb[title]
    ws = wb.create_sheet(title)
    ws.append(["PESQUISA DE PREÇOS | COTAÇÕES REGULARES VERIFICADAS"])
    ws.append(["Registre preço normal (não promocional), embalagem, fonte e data. Sem evidência, deixe o preço vazio."])
    headers = ["Ingrediente", "Unidade", "Atacadista", "Preço regular (R$)", "Qtd. embalagem",
               "Unidade embalagem", "R$/unidade base", "Data cotação", "Fonte / URL", "Status", "Observações"]
    for value in headers:
        ws.cell(4, headers.index(value) + 1, value)
    ws.freeze_panes = "A5"
    ws.auto_filter.ref = f"A4:K{max(4, 4 + (wb['Insumos'].max_row - 4) * 3)}"
    rows = []
    for r in range(5, wb["Insumos"].max_row + 1):
        name = wb["Insumos"].cell(r, 1).value
        unit = wb["Insumos"].cell(r, 2).value
        if name:
            for store in ("Economart Passos", "Mart Minas Passos", "ABC Passos"):
                rows.append((name, unit, store))
    for name, unit, store in rows:
        ws.append([name, unit, store, None, None, None, None, None, None, "Pendente", None])
        row = ws.max_row
        ws.cell(row, 7, f'=IFERROR(D{row}/E{row},"")')
        ws.cell(row, 8).number_format = "dd/mm/yyyy"
        ws.cell(row, 4).fill = PatternFill("solid", fgColor=YELLOW)
        ws.cell(row, 5).fill = PatternFill("solid", fgColor=YELLOW)
        ws.cell(row, 9).fill = PatternFill("solid", fgColor=YELLOW)
    _style_header(ws, 4, 1, 11)
    widths = [31, 13, 24, 20, 18, 18, 22, 16, 60, 16, 35]
    for col, width in enumerate(widths, 1):
        ws.column_dimensions[chr(64 + col)].width = width
    ws.row_dimensions[4].height = 34
    status = DataValidation(type="list", formula1='"Pendente,Confirmado,Estimado,Desatualizado"')
    ws.add_data_validation(status)
    status.add(f"J5:J{ws.max_row}")
    ws.conditional_formatting.add(f"J5:J{ws.max_row}", CellIsRule(operator="equal", formula=['"Pendente"'], fill=PatternFill("solid", fgColor=YELLOW)))
    for row in ws.iter_rows(min_row=5, max_row=ws.max_row):
        row[3].number_format = 'R$ #,##0.00'
        row[6].number_format = 'R$ #,##0.0000'


def _add_inventory_and_transactions(wb) -> None:
    for title, headers in [
        ("Estoque", ["Item", "Tipo", "Unidade", "Saldo inicial", "Entradas", "Consumo/saídas", "Saldo atual", "Estoque mínimo", "Lote", "Validade", "Status", "Observações"]),
        ("Vendas", ["Data", "Produto", "Tipo", "Quantidade", "Preço unitário", "Faturamento", "Forma de pagamento", "Perdas/estornos", "Observações"]),
        ("Historico", ["Data", "Entidade", "Campo", "Valor anterior", "Valor novo", "Fonte", "Responsável", "Observações"]),
        ("Cenarios", ["Cenário", "Salgados/dia", "Preço salgado", "Latas/dia", "Preço lata", "Dias/mês", "Custo lata", "Saldo referência sem outros custos", "Status"]),
        ("Producao", ["Data planejada", "ID receita", "Sabor", "Versão", "Venda planejada", "Estoque disponível", "Lotes", "Produzido", "Excedente", "Consumido ingredientes", "Assado", "Vendido", "Descartado", "Saldo congelado", "Lote", "Observações"]),
    ]:
        if title in wb.sheetnames:
            del wb[title]
        ws = wb.create_sheet(title)
        ws.append([title.upper() + " | REGISTRO OPERACIONAL"])
        ws.append(["Campos amarelos são preenchidos manualmente; confirme unidades, lotes e validade antes de operar."])
        for col, header in enumerate(headers, 1):
            ws.cell(4, col, header)
        _style_header(ws, 4, 1, len(headers))
        ws.freeze_panes = "A5"
        ws.auto_filter.ref = f"A4:{ws.cell(4, len(headers)).column_letter}500"
        for col in range(1, len(headers) + 1):
            ws.column_dimensions[ws.cell(4, col).column_letter].width = min(max(len(headers[col - 1]) + 4, 15), 28)
        ws.row_dimensions[4].height = 32
    ws = wb["Cenarios"]
    for row, name in enumerate(["Econômico", "Mix escolhido", "Reforçado"], 5):
        ws.cell(row, 1, name)
        for col, formula in {2:"=Parametros!B7",3:"=Parametros!B9",4:"=Parametros!B8",5:"=Parametros!B10",6:"=Parametros!B6",7:"=Parametros!G12",8:f"=Parametros!G8*B{row}*C{row}/Parametros!B7+Parametros!G8*D{row}*E{row}/Parametros!B8-G7*D{row}*F{row}-Parametros!G11*F{row}-Parametros!G13*Parametros!G8*F{row}",9:'"Estimado"'}.items():
            ws.cell(row, col, formula)
    ws = wb["Estoque"]
    for row in range(5, 505):
        ws.cell(row, 7, f'=IF(A{row}="","",D{row}+E{row}-F{row})')
        ws.cell(row, 11, f'=IF(A{row}="","",IF(G{row}<=H{row},"Repor","OK"))')
    ws = wb["Vendas"]
    for row in range(5, 505):
        ws.cell(row, 6, f'=IF(OR(D{row}="",E{row}=""),"",D{row}*E{row})')
    ws["A5"].number_format = "dd/mm/yyyy"
    ws = wb["Producao"]
    for row in range(5, 505):
        ws.cell(row, 7, f'=IF(OR(E{row}="",E{row}=0),0,ROUNDUP(MAX(E{row}-F{row},0)/MAX(IFERROR(VLOOKUP(B{row},Fichas!$A$5:$E$20,5,FALSE),0),1),0))')
        ws.cell(row, 8, f'=G{row}*IFERROR(VLOOKUP(B{row},Fichas!$A$5:$E$20,5,FALSE),0)')
        ws.cell(row, 9, f'=MAX(H{row}-MAX(E{row}-F{row},0),0)')
        ws.cell(row, 14, f'=F{row}+H{row}-L{row}-M{row}')


def enhance_workbook(path: str | Path, *, backup: bool = True) -> Path:
    path = Path(path)
    if backup:
        stamp = date.today().strftime("%Y%m%d")
        backup_path = path.with_name(f"{path.stem}.backup-{stamp}{path.suffix}")
        if not backup_path.exists():
            shutil.copy2(path, backup_path)
    wb = load_workbook(path)
    if "Pesquisa de preços" not in wb.sheetnames:
        _add_price_research(wb)
    for name in ("Estoque", "Vendas", "Historico", "Cenarios", "Producao"):
        if name not in wb.sheetnames:
            _add_inventory_and_transactions(wb)
            break
    # Existing workbook used estimated vendor prices with no source date. Preserve them,
    # but label each explicitly rather than imply they are live store quotes.
    ins = wb["Insumos"]
    ins.cell(3, 1, "PREÇOS AMARELOS/AZUIS SÃO ESTIMATIVAS DE REFERÊNCIA; cotações reais exigem fonte e data em Pesquisa de preços.")
    for row in range(5, ins.max_row + 1):
        if ins.cell(row, 1).value:
            ins.cell(row, 7, "Estimado — não é cotação local verificada")
    params = wb["Parametros"]
    params.cell(17, 4, "Agregado inicial R$ 3,50/lata; inclua energia/gelo aqui sem dupla contagem")
    params.cell(16, 4, "Preço aproximado; atualizar com nota/cotação regular")
    # Explicit simple calculator for the reference baseline requested in the prompt.
    ws = wb["Painel"]
    ws["A35"] = "REFERÊNCIA FINANCEIRA DO PROMPT (sem custos de salgados e demais despesas)"
    ws["A35"].font = Font(bold=True, color=BLUE)
    ws["A36"], ws["B36"] = "Saldo combustível mínimo", "=Parametros!G8*Parametros!B6-Parametros!B8*Parametros!G12*Parametros!B6-Parametros!G9/Parametros!B9*Parametros!B7*Parametros!B6-Parametros!G8*Parametros!B6*Parametros!G13"
    ws["A37"], ws["B37"] = "Saldo combustível com folga", "=Parametros!G8*Parametros!B6-Parametros!B8*Parametros!G12*Parametros!B6-Parametros!G11*Parametros!B6-Parametros!G8*Parametros!B6*Parametros!G13"
    ws["A38"] = "Conferir com motor Python: R$ 4.353,23 mínimo; R$ 4.341,68 com folga. Custos de salgados e custos operacionais ficam fora."
    for cell in ["B36", "B37"]:
        ws[cell].number_format = 'R$ #,##0.00'
        ws[cell].fill = PatternFill("solid", fgColor=GREEN)
    ws["A38"].alignment = Alignment(wrap_text=True)
    _add_recipe_validations(wb)
    if wb.calculation is None:
        wb.calculation = CalcProperties()
    wb.calculation.fullCalcOnLoad = True
    wb.calculation.forceFullCalc = True
    wb.calculation.calcMode = "auto"
    wb.save(path)
    return path


def _add_recipe_validations(wb) -> None:
    ws = wb["Mix diario"]
    dv = DataValidation(type="list", formula1='"E,R"', allow_blank=False)
    ws.add_data_validation(dv)
    dv.add("D5:D12")
    ws.auto_filter.ref = "A4:P12"
    ws.freeze_panes = "A5"
    ws = wb["Insumos"]
    ws.auto_filter.ref = f"A4:G{ws.max_row}"
    ws.freeze_panes = "A5"
    ws = wb["Composicao"]
    ws.auto_filter.ref = f"A4:I{ws.max_row}"
    ws.freeze_panes = "A5"


def workbook_financial_summary(path: str | Path) -> dict:
    wb = load_workbook(path, data_only=False)
    p = wb["Parametros"]
    baseline = baseline_finance(savouries_per_day=p["B7"].value, savoury_price=p["B9"].value,
                                drinks_per_day=p["B8"].value, drink_price=p["B10"].value,
                                days_per_month=p["B6"].value,
                                drink_cost=D(p["B16"].value) + D(p["B17"].value),
                                km_minimum=2 * D(p["B11"].value) + 2 * D(p["B12"].value) * D(p["B13"].value),
                                km_buffer_pct=p["B39"].value, km_per_litre=p["B14"].value,
                                fuel_price=p["B15"].value, debit_share=p["B18"].value,
                                credit_share=p["B19"].value, debit_rate=p["B20"].value,
                                credit_rate=p["B21"].value)
    return {key: str(value) for key, value in baseline.__dict__.items()}
