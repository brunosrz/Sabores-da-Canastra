# Sabores da Canastra

Repositório dos sistemas operacionais do Bar Sabores da Canastra. A evolução
principal é uma plataforma web mobile first, composta por dois aplicativos
independentes: **ERP** (`erp.brunosrz.com`) e **PDV** (`pdv.brunosrz.com`). Os
aplicativos Python e a planilha Excel permanecem no repositório como legado
funcional, utilitários e referência para a migração. Os domínios e serviços
remotos ainda não estão publicados.

## Aplicativos web

- [`apps/erp`](apps/erp/README.md): cadastro e operação de produtos,
  ingredientes, receitas, estoque, custos e rotinas administrativas.
- [`apps/pdv`](apps/pdv/README.md): registro de vendas e pagamentos no caixa.
- [Arquitetura web](docs/arquitetura-web.md): stack, execução, CI e decisão de
  backend compartilhado.

O bootstrap atual prepara os dois frontends com TanStack Start, Router, Query,
Form e integração local com Workers. Os fluxos de negócio ainda serão
implementados. Cada app pode ser desenvolvido e validado separadamente.

### Desenvolvimento web

Requisitos: Node.js compatível com o `engines` do projeto e pnpm. Na raiz:

```powershell
pnpm install --frozen-lockfile
pnpm dev:erp
```

Em outro terminal, `pnpm dev:pdv` inicia o PDV. O ERP fica em
`http://127.0.0.1:3001` e o PDV em `http://127.0.0.1:3002`. Ambos têm uma rota
local `/api/health`; ela só verifica o respectivo app e não é a futura API de
negócio.

Comandos de validação separados:

```powershell
pnpm format:check:erp
pnpm lint:erp
pnpm typecheck:erp
pnpm test:erp
pnpm build:erp

pnpm format:check:pdv
pnpm lint:pdv
pnpm typecheck:pdv
pnpm test:pdv
pnpm build:pdv
```

Também existem aliases `*:web`, que executam a verificação correspondente nos
dois apps, e `pnpm lint:docs` para Markdown.

## Backend e banco de dados

A decisão de arquitetura é manter **um único backend de negócio compartilhado**
e um único D1 para ERP e PDV. O futuro Worker de API será responsável por
autenticação, validação e regras de catálogo, receitas, estoque, vendas,
compras, despesas e ledger. Os dois frontends continuarão separados; suas
server functions chamarão o Worker por Service Binding. O navegador não terá
acesso direto ao D1. A API compartilhada ainda não foi criada neste bootstrap.

## Legado Python e planilha

O app desktop Python continua disponível para consulta e uso do sistema legado.
Use Python 3.12+ e [uv](https://docs.astral.sh/uv/):

```powershell
uv sync --group dev
uv run sabores-desktop
```

Para iniciar o PDV desktop legado, rode `uv run sabores-pdv`. Os dois comandos
Python compartilham `%USERPROFILE%\.sabores-da-canastra\sabores.db`; esse SQLite
é separado do futuro D1 dos apps web. Não há sincronização automática entre
eles.

Utilitários e verificações Python:

```powershell
uv run pytest
uv run sabores validar
uv run sabores simular
uv run sabores inspecionar
```

O contrato JSON em [docs/json-contract.md](docs/json-contract.md) descreve a
importação/exportação do legado Python. Ele preserva o ledger SQLite e não é,
neste momento, uma API de sincronização com os apps web.

## Qualidade e CI

Instale os hooks uma vez por clone e rode-os manualmente quando necessário:

```powershell
uvx --from pre-commit==4.7.0 pre-commit install
uvx --from pre-commit==4.7.0 pre-commit run --all-files
```

O pre-commit separa formatação e lint de ERP e PDV, além de verificar Python e
documentação. A CI tem jobs independentes para utilitários/testes Python, ERP,
PDV e documentação. O formatter global Python não foi habilitado para o legado
porque causaria uma reformatação extensa; Ruff, testes e validação do workbook
continuam cobertos. A CI não faz deploy. CodeRabbit pode revisar PRs quando a
integração estiver habilitada no repositório.

## Documentação de referência

- [Arquitetura dos apps web](docs/arquitetura-web.md)
- [Metodologia financeira do sistema Python legado](docs/metodologia.md)
- [Contrato JSON do sistema Python legado](docs/json-contract.md)
- Planos de negócio, divulgação, delivery, investimentos e receitas nos
  arquivos Markdown da raiz.
