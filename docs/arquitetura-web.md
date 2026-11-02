# Arquitetura dos apps web

## Estado deste documento

Esta página descreve o bootstrap e as decisões das etapas seguintes. ERP e PDV
têm telas iniciais e autenticação; os módulos de negócio serão entregues em
etapas posteriores. Os recursos remotos de preview permanecem separados dos de
produção.

## Aplicações

- `apps/erp`: ERP em `erp.brunosrz.com`, para produtos, ingredientes, receitas,
  estoque, custos, compras, despesas e relatórios.
- `apps/pdv`: ponto de venda em `pdv.brunosrz.com`, para registrar pedidos e
  pagamentos.
- `apps/api`: Worker Hono interno, dono do schema D1 e da lógica de negócio
  compartilhada. Expõe saúde, autenticação, catálogo com cache, registro
  idempotente de venda com autoria no ledger e acesso autenticado a backups.

ERP e PDV são interfaces independentes, implantáveis e versionadas
separadamente. ERP e PDV executam localmente como Workers independentes e ainda
têm rotas iniciais e verificação de saúde. A API executa em `127.0.0.1:3000`;
D1, KV, R2, Durable Objects e Workflows usam simuladores locais. Os recursos
remotos de preview foram provisionados. A API e os apps usam Service Bindings.
Os arquivos Python continuam sendo a referência funcional durante a migração,
não os backends dos novos apps.

## Backend e banco compartilhados

O backend de negócio é um único serviço interno em `apps/api`. Esse Worker é o
único com binding direto ao D1 e será responsável por autenticação, regras de
negócio, validação, catálogo/receitas, estoque, vendas, compras, despesas e
ledger. O schema, bindings e rotas iniciais de catálogo, venda, backup e
autenticação estão implementados.

ERP e PDV continuarão sendo dois apps. Suas rotas e server functions do TanStack
Start atuarão como camada de interface/BFF: recebem a sessão da requisição,
chamam o backend via Cloudflare Service Binding e entregam os resultados ao
cliente. O navegador não terá credenciais de D1 nem acesso direto ao banco. A
API não precisa de um terceiro site público; o binding de serviço conecta os
Workers internamente. Os Service Bindings entre os três Workers estão
configurados por ambiente.

As sessões usam cookies opacos `Secure`, `HttpOnly` e `SameSite=Strict`, com
nomes distintos entre preview e produção e domínio compartilhado entre os
subdomínios. O D1 mantém somente o hash do token, validade, revogação e impressão
digital das credenciais configuradas; alterar as credenciais invalida as sessões
existentes. Não existe cadastro aberto: as contas são provisionadas pelo
secret `AUTH_USERS`, com hashes PBKDF2. Login e vendas verificam a origem, e as
tentativas de login são limitadas. Cada venda grava `actor_user_id` no ledger.
Os Workers de preview usam recursos e dados de preview separados dos recursos
de produção.

O SQLite do legado Python é um banco local independente. A migração inicial
exporta uma cópia validada e não cria sincronização contínua entre SQLite e D1.
O endpoint `/health` informa saúde. A importação `/__local/import` exige
hostname local e segredo em `.dev.vars`. Vendas exigem sessão autenticada e
registram o usuário responsável no ledger.

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

`uv run scons api-preview` aplica migrations remotas idempotentes e publica a
API sem rota pública. `uv run scons preview` valida primeiro que os domínios
estão protegidos por políticas Cloudflare Access que permitem um e-mail
específico, depois publica API, ERP e PDV. Produção mantém IDs de exemplo e é
recusada até que seus recursos sejam provisionados.

O preview usa `erp-preview.brunosrz.com` e `pdv-preview.brunosrz.com`; produção
usa `erp.brunosrz.com` e `pdv.brunosrz.com`. Custom Domains criam DNS e TLS na
zona Cloudflare. A API continua sem hostname público e só é acessada via
Service Bindings. O plano Free inclui D1, KV, R2 Standard, Durable Objects com
backend SQLite e Workflows, cada qual com limites de uso; exceder uma cota Free
pode fazer operações falharem. Antes do deploy web, habilite Zero Trust/Access e
crie aplicações protegidas com políticas para um e-mail individual. O SCons
valida aplicação e política e aborta se Access estiver desativado, ausente ou
com regra `bypass`.

`.env.example` contém somente nomes e campos de configuração local. Secrets
remotos ficam em `apps/api/.env.preview` e `apps/api/.env.production`; o SCons
os envia com Wrangler `secret bulk`, sem imprimir os valores. `CLOUDFLARE_API_TOKEN`
precisa ser um token Cloudflare de escopo mínimo para a API de exportação; sem
ele, o Worker publica, mas backups remotos ficam indisponíveis. Nunca coloque
senhas ou tokens em `vars` versionadas.

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
idempotência. Workflows exportam D1 em streaming e aplicam retenção em R2. A
exportação oficial pode bloquear consultas e gravações durante a operação; o
horário configurado para a rotina diária é 06:00 UTC, e a rota manual deve ser
usada na mesma janela operacional. Confirme que esse horário está fora do
expediente antes de ativar produção. D1 Time Travel é a primeira opção para
recuperações pontuais. Alertas externos dependem do provisionamento futuro da
conta. O Worker API é privado sem rota `workers.dev`; ERP e PDV o acessam por
Service Bindings internos configurados por ambiente.
