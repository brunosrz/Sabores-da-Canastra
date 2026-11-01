# Sabores da Canastra

Aplicativo desktop local para registrar a operação diária e acompanhar custos e resultado do negócio. A interface está migrando da planilha para Python; o Excel existente fica preservado como fonte histórica/importável durante a transição. O SQLite guarda o histórico pós-venda, pós-compra e gastos.

## Recursos

- PDV em aplicativo desktop separado para registrar cestas de produtos e vendas, ligado ao mesmo banco SQLite do caixa.
- Divisão de cada venda entre dinheiro, débito, crédito e Pix, com taxas editáveis de cartão e total bruto, taxas, recebido líquido e lucro estimado.
- Relatórios de vendas por período com calendário, comparação com período anterior de mesma duração, gráficos diários e detalhamento por produto e pagamento.
- Cardápio inicial com Monster 473 ml por R$ 12,00 e refrigerantes 350 ml por R$ 6,00, em sabores cadastrados no catálogo.
- Registro de lançamentos datados, com categoria, descrição, quantidade, preço unitário, valor total, forma de pagamento e fornecedor/cliente.
- Histórico filtrável por período e tipo, exclusão de lançamento selecionado.
- Banco SQLite local em `%USERPROFILE%\.sabores-da-canastra\sabores.db`.
- Motor financeiro com `Decimal`, normalização de unidades, custos de lote/unidade, planejamento de lotes, combustível, taxas e cálculos de referência.
- Importação inicial da planilha com oito receitas em versões econômica/reforçada, ingredientes, composição e mix para dentro do SQLite; os preços importados ficam como estimativas.
- Telas para catálogo e cotações com fonte/data/status, edição de composição e rendimentos, mix diário, planejamento por lotes, lista consolidada de compras e relatório financeiro configurável.
- Aba Receitas para criar/editar fichas técnicas com quantidades e unidades por ingrediente; catálogo de produtos vendidos com categorias e preço.
- Exportação e importação JSON versão 1 para edição em massa do catálogo, receitas, produtos, mix e premissas. Importar preserva integralmente os lançamentos no SQLite.
- Validação do workbook e comandos de inspeção, simulação e atualização da planilha.

## Requisitos e execução com uv

Use Python 3.12 ou superior. Instale o [uv](https://docs.astral.sh/uv/) e, na pasta do projeto, rode:

```powershell
uv sync --group dev
uv run sabores-desktop
```

O comando acima abre o aplicativo de **compras, gastos, custos, receitas e histórico**. Para abrir o ponto de venda separado, use:

```powershell
uv run sabores-pdv
```

Os dois aplicativos usam `%USERPROFILE%\.sabores-da-canastra\sabores.db`; venda lançada no PDV aparece no mesmo histórico do caixa. Configure as taxas de débito e crédito na tela do PDV.

### Atalhos independentes no Windows

Para criar atalhos próprios de **PDV** e **Gestão** na Área de Trabalho, execute uma vez na pasta do repositório:

```powershell
powershell -ExecutionPolicy Bypass -File .\Criar-Atalhos-Windows.ps1
```

Depois, fixe cada atalho separadamente na barra de tarefas ou no Menu Iniciar. Cada janela define um AppUserModelID próprio do Windows, e os arquivos `.bat` iniciam os comandos sem manter uma janela de terminal visível. Também é possível abrir diretamente `Abrir-PDV.bat` ou `Abrir-Gestao.bat`.

Alternativas:

```powershell
uv run python -m sabores app
uv run pytest
uv run sabores validar
uv run sabores simular
uv run sabores inspecionar
```

O app cria o banco automaticamente na primeira execução. A primeira abertura importa o catálogo e as fichas da planilha do repositório para o banco local, sem substituir cotações ou marcar estimativas como confirmadas. Na aba **Receitas**, cadastre também bebidas, doces e molhos como produtos vendáveis e informe o preço; depois eles aparecem na cesta do caixa por categoria. Para usar outro arquivo SQLite em desenvolvimento, instancie `Ledger("caminho/arquivo.db")`; os dados são locais e não há sincronização em nuvem.

## Uso diário

1. Use `uv run sabores-pdv` para lançar vendas e dividir recebimentos entre as quatro formas de pagamento.
2. Use `uv run sabores-desktop` para registrar compras e gastos, editar ingredientes, produtos e receitas e consultar o histórico comum.
3. Informe custo unitário ou complete a ficha técnica para que o PDV estime o lucro; enquanto faltar custo, o relatório sinaliza lucro parcial.
4. Escolha datas específicas ou atalhos de hoje, semana e mês para comparar venda bruta, taxas e líquido com o período anterior.

Valores são guardados em centavos inteiros no SQLite para evitar erros de ponto flutuante. Datas são armazenadas como `AAAA-MM-DD` e validadas. Lançamentos são registros reais informados pelo usuário; não são gerados a partir das metas de planejamento.

O contrato de importação/exportação e exemplos estão em [docs/json-contract.md](docs/json-contract.md). JSON inclui configurações editáveis e deliberadamente exclui vendas, compras e gastos históricos.

## Estrutura

- `src/sabores/database.py`: persistência SQLite e consultas agregadas por dia/mês.
- `src/sabores/desktop.py`: caixa de compras/gastos, custos, receitas e configuração.
- `src/sabores/pos.py`: aplicativo desktop de ponto de venda e relatórios de vendas.
- `src/sabores/finance.py`: cálculos reutilizáveis.
- `src/sabores/workbook.py`: manutenção/validação da planilha legada e painel financeiro.
- `src/sabores/cli.py`: comandos.
- `sabores_da_canastra_custos_salgados.xlsx`: workbook anterior e fichas técnicas preservadas.
- `docs/metodologia.md`: premissas, fórmulas e origem de dados.
- `tests/`: testes do motor, SQLite e integração com workbook.

## Escopo e limitações atuais

O aplicativo é um livro-caixa e ferramenta local de custos/planejamento, não um CMS, e não se conecta a adquirentes, bancos, fornecedores ou serviço remoto. Vendas, compras e gastos são lançamentos reais manuais. Ingredientes, cotações, receitas, composição, rendimentos, mix, premissas, custos por lote, lotes planejados e compras projetadas ficam no SQLite. Custo unitário fica pendente enquanto faltar preço de qualquer ingrediente; lançamentos realizados ficam separados dos cenários configurados.

Os preços em Insumos e rendimentos de receitas são estimativas herdadas, não cotações confirmadas. Preços regulares precisam de fonte e data; ofertas não devem ser confundidas com preços normais. Dados de validade e estoque são registros auxiliares, não validação de segurança alimentar.
