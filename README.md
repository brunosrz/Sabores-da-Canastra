# Sabores da Canastra — custos e planejamento

Projeto local em Python + Excel para fichas técnicas, premissas financeiras, compras e acompanhamento da produção de salgados assados e refrigerantes. A planilha continua sendo a interface editável; o Python valida os cadastros e calcula os indicadores de referência com `Decimal`.

## Conteúdo

- `sabores_da_canastra_custos_salgados.xlsx`: planilha original preservada e ampliada. Antes da primeira atualização, o programa cria um backup com data.
- `src/sabores/finance.py`: custos normalizados, lotes, combustível, taxas, lista agregada de ingredientes e referência financeira.
- `src/sabores/workbook.py`: inspeção, validação e integração não destrutiva da pasta de trabalho.
- `src/sabores/cli.py`: comandos locais.
- `tests/`: testes do motor e da preservação da planilha.
- `docs/metodologia.md`: regras de cálculo, dados e limitações.

## Instalação e comandos

Requer Python 3.12+. No Windows:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
py -m pip install -e ".[test]"
py -m sabores inspecionar
py -m sabores validar
py -m sabores simular
py -m sabores atualizar-excel
```

O argumento `--excel` aponta para outra pasta de trabalho. Exemplo:

```powershell
py -m sabores validar --excel "D:\caminho\custos.xlsx"
```

Comandos adicionais aceitos: `calcular-receitas`, `planejar-producao` e `gerar-compras`. As fichas e necessidades detalhadas continuam editadas na planilha; esses atalhos estão reservados para próximos fluxos de cálculo por lote.

## Usar a planilha

1. Edite premissas em **Parametros**. Valores zero para trabalho e tributos indicam dados ainda não definidos, não custo real nulo.
2. Atualize preços, embalagem e unidade de compra em **Insumos**. Valores existentes são estimativas conservadoras, não cotações verificadas.
3. Registre cada cotação normal, não promocional, na aba **Pesquisa de preços**, com data, quantidade/embalagem, fonte e status. Preços ausentes ficam vazios; não há média automática de valores promocionais ou inventados.
4. Ajuste quantidades da receita em **Composicao** e rendimento real em **Fichas** depois de pesar uma produção. As fichas existentes são estimativas de teste.
5. No **Mix diario**, altere a quantidade e escolha E (econômica) ou R (reforçada); a soma deve corresponder ao parâmetro diário.
6. Use **Producao** para registrar lotes e saídas, **Estoque** para entradas/consumo/validade e **Vendas** para operações reais. Os registros são manuais; o programa não inventa movimentos.
7. Rode `py -m sabores validar` antes de confiar nos dados e `py -m sabores simular` para o cálculo Python de referência.

As células azuis/amarelas na planilha significam entrada editável segundo o estilo existente; cabeçalhos, filtros, congelamento de painéis e listas de validação ajudam na navegação. O Excel recalcula fórmulas ao abrir. `openpyxl` não calcula as fórmulas e não atualiza seus valores em cache: abra/salve no Excel ou LibreOffice para atualizar valores de fórmulas no próprio arquivo.

## Parâmetros iniciais conferidos

| Indicador | Resultado |
|---|---:|
| Faturamento diário | R$ 295,00 |
| Faturamento mensal (20 dias) | R$ 5.900,00 |
| Custo mensal das latas a R$ 3,50 | R$ 1.400,00 |
| Combustível mínimo (22 km/dia) | R$ 77,00 |
| Combustível com 15% de folga | R$ 88,55 |
| Taxas ponderadas (25% débito + 25% crédito) | R$ 69,77/mês |
| Saldo referência sem custo de salgados/outros (combustível mínimo) | R$ 4.353,23 |
| Mesmo saldo com 15% de folga de combustível | R$ 4.341,68 |

O custo de lata agregado de R$ 3,50 já inclui a estimativa de R$ 0,50 para frio/gelo. Não some esses mesmos custos novamente em outra rubrica. A aba Painel também tem uma referência separada de saldo mínimo/planejado; demais custos permanecem fora desses dois valores.

## Pesquisa e fontes

Endereços/canais oficiais e materiais de referência estão na aba **Fontes**. A pesquisa de preços no prompt não forneceu cotações atuais normais verificáveis para os três atacadistas; os campos começam como **Pendente**. Os encartes encontrados são promocionais e, portanto, não alimentam o preço regular. Confirme o pacote e o preço no canal da loja antes de marcar Confirmado. Consulte `docs/metodologia.md` para URLs e regras.

## Limitações

- A planilha anterior tinha mais de 1.200 fórmulas e oito abas; elas foram preservadas. O sistema acrescenta estrutura de registro, mas não sincroniza vendas, estoque ou histórico automaticamente: a pessoa usuária registra as movimentações.
- As oito receitas em versões econômica/reforçada usam quantidades de teste. Referências culinárias ajudam a definir técnica, mas não provam que o lote da planilha rende o número estimado.
- Datas, taxas, custos fixos, despesas e rendimento devem ser confirmados localmente. Sem cotações atuais não existe “menor preço” ou média de loja calculável.
- A precisão do cálculo não elimina incerteza das hipóteses. Excel é fonte autoritativa para entradas; Python valida e calcula a referência financeira a partir dos parâmetros lidos.
- Refrigeração, congelamento, validade, rotulagem, tributos e requisitos para venda ambulante precisam de procedimento/avaliação apropriados antes da operação.
