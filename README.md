# Sabores da Canastra

Repositório dos sistemas operacionais do Bar Sabores da Canastra. A evolução
principal é uma plataforma web mobile first, composta por dois aplicativos
independentes: **ERP** (`erp.brunosrz.com`) e **PDV** (`pdv.brunosrz.com`). Os
aplicativos Python e a planilha Excel permanecem no repositório como legado
funcional, utilitários e referência para a migração. A API e os dois apps têm
estrutura de preview protegida por Cloudflare Access. O PDV já oferece fluxo de
vendas mobile-first com fila local e sincronização; o ERP segue evoluindo seus
módulos administrativos.

## Aplicativos web

- [`apps/erp`](apps/erp/README.md): cadastro e operação de produtos,
  ingredientes, receitas, estoque, custos e rotinas administrativas.
- [`apps/pdv`](apps/pdv/README.md): registro de vendas e pagamentos no caixa.
- [`apps/api`](apps/api/README.md): backend compartilhado Hono, schema D1 e
  migração local dos dados legados.
- [Arquitetura web](docs/arquitetura-web.md): stack, execução, CI e decisão de
  backend compartilhado.

ERP e PDV usam TanStack Start, Router, Query e Form. A API compartilhada usa
Hono; seus bindings D1, KV, R2, Durable Objects e Workflows têm simuladores
locais. D1 é a fonte de verdade do catálogo, vendas e ledger; o PDV mantém
rascunhos, catálogo e fila de sincronização no IndexedDB para continuar lançando
vendas sem internet. Cancelamentos e correções são eventos auditáveis. A
migração do legado Python/Excel é revisável e não modifica a origem.

### Idioma, tema e preferências compartilhadas

Em **Ajustes → Preferências**, ERP e PDV permitem selecionar português ou inglês
e o tema claro, escuro ou do sistema. Os seletores ficam somente em Ajustes.
Cookies `sabores_locale` e `sabores_theme`, com domínio `brunosrz.com`, compartilham
essas preferências entre os dois aplicativos no mesmo navegador, inclusive entre
preview e produção. Não contêm identidade nem credenciais. O tema é aplicado ao
retornar ao app; mudar o idioma recarrega a página para atualizar todas as mensagens.
Em localhost, os cookies ficam restritos ao host. Navegadores ou dispositivos
diferentes mantêm suas próprias preferências.

As mensagens Paraglide estão em `packages/i18n/messages/{pt-BR,en}.json`.
`pnpm install` compila o runtime; `pnpm i18n:compile` permite recompilá-lo
manualmente, e o plugin Vite acompanha alterações durante o desenvolvimento.
Traduções afetam a apresentação, preservando nomes cadastrados, códigos, valores
dos pagamentos e contratos de sincronização. Datas e valores usam o idioma
escolhido; a moeda continua sendo o real brasileiro.

`uv run python utils/sort_translation_keys.py --write` ordena as chaves sem
alterar os valores, usando o utilitário do Vectora adaptado aos caminhos deste
monorepo. O pre-commit executa a ordenação automaticamente e recompila o Paraglide
quando os catálogos ou sua configuração mudam.

### Base nativa em andamento

Os projetos Capacitor do ERP e do PDV estão em `apps/erp/{android,ios}` e
`apps/pdv/{android,ios}`. A partir da raiz, `pnpm --filter @sabores/pdv
mobile:sync:android` e `pnpm --filter @sabores/erp mobile:sync:android` geram
os assets e os copiam para os projetos Android. Os comandos equivalentes com
`mobile:sync:ios` preparam os projetos iOS em um ambiente com Xcode.

O shell nativo ainda está em desenvolvimento: os endpoints relativos `/api/*`
dos sites dependem dos Workers, portanto login, API, dados offline e distribuição
nativa ainda precisam ser integrados e validados. Copiar assets com Capacitor
não comprova que o aplicativo instalado funciona nem gera um pacote assinado.

ERP e PDV usam Dexie para leitura dos catálogos e das filas já existentes; o
PDV também usa Dexie para rascunhos. As operações atômicas continuam no
IndexedDB existente. A abertura preserva os bancos legados e não sincroniza,
por si só, dispositivos ou origens distintas.

### Desenvolvimento web

Requisitos: Node.js compatível com o `engines` do projeto e pnpm. Na raiz:

```powershell
pnpm install --frozen-lockfile
pnpm dev:erp
```

Em outros terminais, `pnpm dev:pdv` inicia o PDV e `pnpm dev:api` inicia a API.
O ERP fica em `http://127.0.0.1:3001`, o PDV em `http://127.0.0.1:3002` e a API
em `http://127.0.0.1:3000`. `/api/health` nos frontends e `/health` na API
verificam disponibilidade. Migrações e importações usam apenas o D1 local.

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
aplica o schema no D1 local via Wrangler; os comandos de desenvolvimento não
usam banco remoto. Deploy em preview/produção só é permitido após provisionar
recursos Cloudflare separados e substituir IDs de exemplo. Os scripts
`deploy:preview` e `deploy:production` fazem essa validação.

### Publicação Cloudflare

O SCons coordena migrations D1, secrets da API e deploy explícito. Preview usa
`erp-preview.brunosrz.com` e `pdv-preview.brunosrz.com`; produção usa
`erp.brunosrz.com` e `pdv.brunosrz.com`. Antes de publicar as interfaces,
configure Cloudflare Access com políticas que permitam somente seu e-mail.

```powershell
uv sync --group dev
Copy-Item .env.example .env
Copy-Item apps/api/.env.preview.example apps/api/.env.preview
uv run scons api-preview
uv run scons preview
```

Preencha `.env` com o token Cloudflare, Account ID e Zone ID. Gere os três
tokens de aplicação em `apps/api/.env.preview`; `CLOUDFLARE_API_TOKEN` (nesse
arquivo, diferente do token local de deploy no `.env` raiz) pode ficar
vazio no primeiro deploy, mas backups remotos só funcionarão depois de
configurá-lo com um token Cloudflare de escopo mínimo. Arquivos preenchidos são
ignorados pelo Git. `scons api-preview` publica somente a API sem rota pública;
`scons preview` valida políticas Access para os dois domínios antes de publicar
ERP e PDV. `uv run scons prod` usa secrets, bindings e políticas Access
separados e não deve ser executado até provisionar e revisar produção.

## Backend e banco de dados

ERP e PDV usam **um único backend de negócio compartilhado** e um D1 por
ambiente. O Worker Hono em `apps/api` contém schema e bindings. KV mantém
apenas cache descartável; R2 guarda backups privados; Durable Objects
serializam operações de venda por dispositivo; Workflows exportam D1. A
autenticação é compartilhada, sem cadastro aberto. O SQLite do Python permanece
independente, sem sincronização automática com D1; a migração é uma cópia
inicial validada e reconciliada.

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

### Releases e ambientes do GitHub

Release Please acompanha a linha estável `master` (milestone `0.1.x`) e a linha
de desenvolvimento `release/0.2` (milestone `0.2`). Títulos de PR seguem
Conventional Commits; changelog e versões são gerados a partir deles. Ao
publicar uma nova versão minor, o workflow avança a branch e as milestones da
linha de desenvolvimento. Os utilitários e os workflows de release têm testes
próprios em `utils/`.

Os environments GitHub `preview` e `production` possuem as variáveis de conta,
zone e e-mails do Access. Os tokens PDV, catálogo e backup são segredos separados
por ambiente. Em produção, os três segredos de aplicação foram gerados e
cadastrados no environment. Isso não provisiona recursos Cloudflare: o D1, KV,
R2, rotas Access e token de exportação D1 da produção ainda precisam ser
configurados antes de qualquer deploy de produção.

`.env.gha.example` documenta os nomes esperados por futuros workflows de deploy
e release; `.env.gha` local é ignorado pelo Git. `RELEASE_PLEASE_TOKEN` é
opcional: sem ele, Release Please usa `GITHUB_TOKEN`, cujas PRs geradas não
iniciam outros workflows. O fluxo de release não publica os aplicativos.

## Documentação de referência

- [Arquitetura dos apps web](docs/arquitetura-web.md)
- [Metodologia financeira do sistema Python legado](docs/metodologia.md)
- [Contrato JSON do sistema Python legado](docs/json-contract.md)
- Planos de negócio, divulgação, delivery, investimentos e receitas nos
  arquivos Markdown da raiz.
