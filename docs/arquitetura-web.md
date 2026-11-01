# Arquitetura dos apps web

## Aplicações

- `apps/erp`: ERP em `erp.brunosrz.com`, para produtos, ingredientes, receitas,
  estoque, custos, compras, despesas e relatórios.
- `apps/pdv`: ponto de venda em `pdv.brunosrz.com`, para registrar pedidos e
  pagamentos.

ERP e PDV são interfaces independentes, implantáveis e versionadas
separadamente. Neste bootstrap, cada uma executa localmente como Worker e tem
somente rotas de interface e uma verificação de saúde; recursos Cloudflare,
domínios e credenciais ainda não estão ligados.

## Backend e banco compartilhados

O backend de negócio será um único serviço interno, planejado para `apps/api`.
Ele será o único Worker com binding direto ao D1 e será responsável por
autenticação, regras de negócio, validação, operações de catálogo/receitas,
estoque, vendas, compras, despesas e ledger. O banco será o mesmo para ERP e
PDV, evitando cópias divergentes de dados e regras.

ERP e PDV continuarão sendo dois apps. Suas rotas e server functions do TanStack
Start atuarão como camada de interface/BFF: recebem a sessão da requisição,
chamam o backend via Cloudflare Service Binding e entregam os resultados ao
cliente. O navegador não terá credenciais de D1 nem acesso direto ao banco. A
API não precisa de um terceiro site público; o binding de serviço conecta os
Workers internamente.

As sessões serão emitidas para autenticação nos dois subdomínios, com cookies
`Secure`, `HttpOnly` e política de domínio/CSRF definida na etapa de autenticação.
Não haverá cadastro aberto. Os Workers de preview usarão recursos e dados de
preview separados dos recursos de produção.

Esse backend compartilhado ainda não faz parte do bootstrap. Os endpoints
`/api/health` existentes só indicam que cada app está ativo; eles não representam
a API de negócio.

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
produto. A API compartilhada será uma aplicação/Worker próprio, não mais uma
biblioteca TanStack; o CI ganhará um job independente para ela quando for
introduzida.

## Comandos na raiz

- `pnpm dev:erp` / `pnpm dev:pdv`
- `pnpm build:erp`, `pnpm test:erp`, `pnpm lint:erp`, `pnpm typecheck:erp`,
  `pnpm format:check:erp`
- `pnpm build:pdv`, `pnpm test:pdv`, `pnpm lint:pdv`, `pnpm typecheck:pdv`,
  `pnpm format:check:pdv`
- Os aliases `*:web` executam o mesmo comando para os dois apps.
- `pnpm lint:docs` verifica a documentação Markdown.

O CI executa jobs independentes para os utilitários/testes Python, ERP, PDV e
documentação. O lint Ruff legado seleciona erros críticos; o formatador Python
não está habilitado para o código existente porque ele não segue o formato
Ruff e uma reformatação em massa foi evitada. Os apps web têm formatação
Prettier em hooks próprios.

Nenhum comando deste bootstrap publica Workers. Cada app tem ambientes locais,
preview e produção descritos no `wrangler.jsonc`, sem IDs de recursos ou
credenciais remotas.
