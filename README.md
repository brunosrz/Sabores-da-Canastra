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
- [`apps/api`](apps/api/README.md): backend compartilhado Hono, schema D1 e
  migração local dos dados legados.
- [Arquitetura web](docs/arquitetura-web.md): stack, execução, CI e decisão de
  backend compartilhado.

ERP e PDV usam TanStack Start, Router, Query e Form. A API compartilhada usa
Hono e possui migration D1 local e importador validado. Fluxos de negócio,
autenticação e conexão dos frontends com a API ainda serão implementados. Cada
app possui checks independentes.

### Desenvolvimento web

Requisitos: Node.js compatível com o `engines` do projeto e pnpm. Na raiz:

```powershell
pnpm install --frozen-lockfile
pnpm dev:erp
```

Em outros terminais, `pnpm dev:pdv` inicia o PDV e `pnpm dev:api` inicia a API.
O ERP fica em `http://127.0.0.1:3001`, o PDV em `http://127.0.0.1:3002` e a API
em `http://127.0.0.1:3000`. `/api/health` nos frontends e `/health` na API só
verificam disponibilidade; as telas ainda não usam o backend.

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

pnpm format:check:api
pnpm lint:api
pnpm typecheck:api
pnpm test:api
pnpm build:api
```

Também existem aliases `*:web`, que executam a verificação correspondente nos
dois frontends, e `pnpm lint:docs` para Markdown. `pnpm db:migrate:local`
aplica o schema no D1 local via Wrangler; os comandos não usam banco remoto.

## Backend e banco de dados

ERP e PDV usarão **um único backend de negócio compartilhado** e um único D1.
O Worker Hono em `apps/api` já contém o schema e a migração local. Autenticação,
endpoints de negócio e bindings dos frontends ainda serão implementados. Os
domínios planejados não estão publicados. O SQLite do Python permanece
independente, sem sincronização automática com D1; a migração é uma cópia
inicial validada.

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

O pacote de migração D1 usa o contrato `sabores-da-canastra/d1-import`, versão 1.
Primeiro rode `uv run sabores prever-migracao-d1`; para gerar o artefato local use
`uv run sabores exportar-migracao-d1 --saida .local/d1-import.json`. A importação
exige D1 local, token em `apps/api/.dev.vars` e
`pnpm db:import:local -- .local/d1-import.json`. O artefato pode conter dados
financeiros reais e `.local/` é ignorado pelo Git.

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
