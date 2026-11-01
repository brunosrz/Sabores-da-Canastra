# Arquitetura dos apps web

## Aplicações

- `apps/erp`: ERP em `erp.brunosrz.com`, para produtos, ingredientes, receitas,
  estoque, custos, compras, despesas e relatórios.
- `apps/pdv`: ponto de venda em `pdv.brunosrz.com`, para registrar pedidos e
  pagamentos.

São aplicações independentes e implantáveis separadamente. Neste bootstrap,
ambas executam localmente como Workers pela integração oficial Vite/Cloudflare.
Bindings D1/KV/R2/DO, domínios e credenciais ficam para as etapas de
infraestrutura e produto.

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

## Comandos na raiz

- `pnpm dev:erp` / `pnpm dev:pdv`
- `pnpm build:web`, `pnpm test:web`, `pnpm lint:web`, `pnpm typecheck:web`
- `pnpm format:check:web`

Nenhum comando deste bootstrap publica Workers. Cada app tem ambientes locais,
preview e produção descritos no `wrangler.jsonc`, sem IDs de recursos ou
credenciais remotas.
