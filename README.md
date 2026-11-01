# Sabores da Canastra

Aplicativo desktop local para registrar a operação diária e acompanhar custos e resultado do negócio. A interface está migrando da planilha para Python; o Excel existente fica preservado como fonte histórica/importável durante a transição. O SQLite guarda o histórico pós-venda, pós-compra e gastos.

## Recursos

- Caixa do dia com total de vendas, compras, gastos e saldo.
- Registro de lançamentos datados, com categoria, descrição, quantidade, preço unitário, valor total, forma de pagamento e fornecedor/cliente.
- Histórico filtrável por período e tipo, exclusão de lançamento selecionado.
- Banco SQLite local em `%USERPROFILE%\.sabores-da-canastra\sabores.db`.
- Motor financeiro com `Decimal`, normalização de unidades, custos de lote/unidade, planejamento de lotes, combustível, taxas e cálculos de referência.
- Importação inicial da planilha com oito receitas em versões econômica/reforçada, ingredientes, composição e mix para dentro do SQLite; os preços importados ficam como estimativas.
- Telas para catálogo e cotações com fonte/data/status, edição de composição e rendimentos, mix diário, planejamento por lotes, lista consolidada de compras e relatório financeiro configurável.
- Validação do workbook e comandos de inspeção, simulação e atualização da planilha.

## Requisitos e execução com uv

Use Python 3.12 ou superior. Instale o [uv](https://docs.astral.sh/uv/) e, na pasta do projeto, rode:

```powershell
uv sync --group dev
uv run sabores-desktop
```

Alternativas:

```powershell
uv run python -m sabores app
uv run pytest
uv run sabores validar
uv run sabores simular
uv run sabores inspecionar
```

O app cria o banco automaticamente na primeira execução. A primeira abertura importa o catálogo e as fichas da planilha do repositório para o banco local, sem substituir cotações ou marcar estimativas como confirmadas. Para usar outro arquivo SQLite em desenvolvimento, instancie `Ledger("caminho/arquivo.db")`; os dados são locais e não há sincronização em nuvem.

## Uso diário

1. Abra o app e registre cada venda, compra de mercadoria ou gasto quando ocorrer.
2. Se houver quantidade e preço unitário, preencha ambos para calcular o total; também é possível lançar apenas o valor total.
3. Selecione data, categoria, forma de pagamento e, quando útil, fornecedor ou cliente.
4. O resumo do topo acompanha o dia atual; o histórico permite consultar outros períodos e filtrar o tipo.
5. O saldo é vendas menos compras e gastos registrados. É uma visão de caixa dos lançamentos, não apuração contábil, lucro líquido ou posição de estoque.

Valores são guardados em centavos inteiros no SQLite para evitar erros de ponto flutuante. Datas são armazenadas como `AAAA-MM-DD` e validadas. Lançamentos são registros reais informados pelo usuário; não são gerados a partir das metas de planejamento.

## Estrutura

- `src/sabores/database.py`: persistência SQLite e consultas agregadas por dia/mês.
- `src/sabores/desktop.py`: interface desktop Tkinter.
- `src/sabores/finance.py`: cálculos reutilizáveis.
- `src/sabores/workbook.py`: manutenção/validação da planilha legada e painel financeiro.
- `src/sabores/cli.py`: comandos.
- `sabores_da_canastra_custos_salgados.xlsx`: workbook anterior e fichas técnicas preservadas.
- `docs/metodologia.md`: premissas, fórmulas e origem de dados.
- `tests/`: testes do motor, SQLite e integração com workbook.

## Escopo e limitações atuais

O aplicativo é um livro-caixa e ferramenta local de custos/planejamento, não um CMS, e não se conecta a adquirentes, bancos, fornecedores ou serviço remoto. Vendas, compras e gastos são lançamentos reais manuais. Ingredientes, cotações, receitas, composição, rendimentos, mix, premissas, custos por lote, lotes planejados e compras projetadas ficam no SQLite. Custo unitário fica pendente enquanto faltar preço de qualquer ingrediente; lançamentos realizados ficam separados dos cenários configurados.

Os preços em Insumos e rendimentos de receitas são estimativas herdadas, não cotações confirmadas. Preços regulares precisam de fonte e data; ofertas não devem ser confundidas com preços normais. Dados de validade e estoque são registros auxiliares, não validação de segurança alimentar.
