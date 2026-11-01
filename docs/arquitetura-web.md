# Arquitetura dos apps web

## Estado deste documento

Esta página descreve o bootstrap e as decisões das etapas seguintes. ERP e PDV
têm infraestrutura e rotas iniciais, mas ainda não implementam os fluxos de
negócio nem estão ligados à API. Domínios e recursos remotos são planejados,
não publicados.

## Aplicações

- `apps/erp`: ERP em `erp.brunosrz.com`, para produtos, ingredientes, receitas,
  estoque, custos, compras, despesas e relatórios.
- `apps/pdv`: ponto de venda em `pdv.brunosrz.com`, para registrar pedidos e
  pagamentos.
- `apps/api`: Worker Hono interno, dono do schema D1 e da lógica de negócio
  compartilhada. Expõe saúde, catálogo com cache, registro idempotente de venda
  e acesso autenticado a backups privados.

ERP e PDV são interfaces independentes, implantáveis e versionadas
separadamente. ERP e PDV executam localmente como Workers independentes e ainda
têm rotas iniciais e verificação de saúde. A API executa em `127.0.0.1:3000`;
D1, KV, R2, Durable Objects e Workflows usam simuladores locais. Recursos
remotos, domínios e credenciais ainda não estão ligados. Os arquivos Python continuam sendo a
referência funcional durante a migração, não os backends dos novos apps.

## Backend e banco compartilhados

O backend de negócio é um único serviço interno em `apps/api`. Esse Worker é o
único com binding direto ao D1 e será responsável por autenticação, regras de
negócio, validação, catálogo/receitas, estoque, vendas, compras, despesas e
ledger. O schema, bindings e rotas iniciais de catálogo, venda e backup estão
implementados; autenticação de usuários e integração com os frontends ainda
não.

ERP e PDV continuarão sendo dois apps. Suas rotas e server functions do TanStack
Start atuarão como camada de interface/BFF: recebem a sessão da requisição,
chamam o backend via Cloudflare Service Binding e entregam os resultados ao
cliente. O navegador não terá credenciais de D1 nem acesso direto ao banco. A
API não precisa de um terceiro site público; o binding de serviço conecta os
Workers internamente. Os bindings entre os três Workers ainda não estão
configurados.

As sessões serão emitidas para autenticação nos dois subdomínios, com cookies
`Secure`, `HttpOnly` e política de domínio/CSRF definida na etapa de autenticação.
Não haverá cadastro aberto. Os Workers de preview usarão recursos e dados de
preview separados dos recursos de produção.

O SQLite do legado Python é um banco local independente. A migração inicial
exporta uma cópia validada e não cria sincronização contínua entre SQLite e D1.
O endpoint `/health` informa saúde. A importação `/__local/import` exige
hostname local e segredo em `.dev.vars`. Vendas exigem segredo transitório do
PDV; a sessão de usuário substituirá esse mecanismo na issue #6.

## Bibliotecas TanStack

### Incluídas desde o bootstrap

- **Start**: framework full stack e integração SSR; inclui o modelo de rotas do
  **Router**, rotas server-side e server functions. Não se mantém um Hono
  duplicado dentro de cada aplicação.
- **Query** e `react-router-ssr-query`: cache e estado assíncrono do servidor,
  hidratação e invalidação. `getRouter()` cria um `QueryClient` por instância do
  router, evitando compartilhar cache SSR entre requisições.
- **Query Devtools** e **Router Devtools**: somente no modo de desenvolvimento.
- **Form**: base para cadastros no ERP e lançamento de venda no PDV.
- **Table**: incluída no ERP para grades de produtos, ingredientes, receitas e
  relatórios.

### Avaliados para etapas posteriores

- **Virtual**: adicionar se medições mostrarem que listas grandes precisam de
  virtualização.
- **Pacer**: útil se busca/filtragem debounced se tornar necessária.
- **Hotkeys**: avaliar quando o fluxo do PDV definir atalhos explícitos; leitores
  de código de barras que enviam Enter não exigem isso por si só.
- **Charts**: avaliar quando os relatórios forem implementados e os requisitos
  de visualização estiverem definidos.
- **DB**: atualmente beta/RC; D1 permanece a fonte persistente de verdade.
- **Store**: alpha e redundante para estado de servidor (Query) e estado local
  simples da interface.
- **AI, Markdown, Highlight, Redact**: sem necessidade nos fluxos previstos.
- **CLI**: usado como ferramenta de scaffolding, não dependência de runtime.
- **Config**: voltado a publicar/manter pacotes, não é necessário para estes
  dois aplicativos.

O catálogo completo do TanStack está registrado aqui para orientar decisões de
produto. A API compartilhada é um Worker Hono próprio, sem duplicar backend nos
dois apps, e tem job independente no CI.

## Comandos na raiz

- `pnpm dev:erp` / `pnpm dev:pdv`
- `pnpm dev:api` / `pnpm db:migrate:local`
- `pnpm build:erp`, `pnpm test:erp`, `pnpm lint:erp`, `pnpm typecheck:erp`,
  `pnpm format:check:erp`
- `pnpm build:pdv`, `pnpm test:pdv`, `pnpm lint:pdv`, `pnpm typecheck:pdv`,
  `pnpm format:check:pdv`
- `pnpm build:api`, `pnpm test:api`, `pnpm lint:api`, `pnpm typecheck:api`,
  `pnpm format:check:api`
- Os aliases `*:web` executam o mesmo comando para os dois apps.
- `pnpm lint:docs` verifica a documentação Markdown.

O CI executa jobs independentes para os utilitários/testes Python, ERP, PDV,
API/D1 e documentação. O pre-commit usa hooks de formatação e lint separados para cada
frontend e para a API. O lint Ruff legado seleciona erros críticos; o formatador Python não
está habilitado para o código existente porque ele não segue o formato Ruff e
uma reformatação em massa foi evitada. Os apps web têm formatação Prettier em
hooks próprios. Os comandos publicados no PR são os mesmos definidos no
`package.json` da raiz.

Nenhum comando desta etapa publica Workers ou acessa D1 remoto. O `wrangler.jsonc`
declara recursos com IDs distintos de exemplo para preview e produção; os
scripts de deploy recusam esses valores até que os recursos reais sejam
provisionados. Nenhum recurso remoto foi criado ou alterado nesta etapa.

### Idempotência Cloudflare

O schema D1 usa migrations incrementais versionadas pelo Wrangler. Objetos da
migration inicial são declarados com `IF NOT EXISTS`, e o Wrangler registra
migrations aplicadas para que uma segunda execução não as aplique novamente.
Como SQLite não possui `ADD COLUMN IF NOT EXISTS`, migrations futuras devem
inspecionar `PRAGMA table_info` antes de adicionar uma coluna. Nunca editar uma
migration já aplicada; criar uma nova versão preserva histórico e repetibilidade.

D1 é a fonte de verdade para dados financeiros: chaves únicas/idempotentes e
lotes transacionais protegem contra reenvio. KV guarda apenas cache de catálogo
com TTL e fallback para D1; nunca participa de cálculo financeiro. R2 guarda
backups privados SQL e manifestos SHA-256, baixados por rota autenticada. O
Durable Object serializa vendas por chave e D1 guarda o hash e o recibo de
idempotência. Workflows exportam D1 e aplicam retenção em R2. D1 Time Travel
permite recuperação pontual sem depender do backup agendado. Alertas externos
dependem do provisionamento futuro da conta.
