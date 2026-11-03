# Sabores da Canastra PDV

Aplicação web independente para registrar vendas no caixa em
`pdv.brunosrz.com`. O fluxo permite localizar produtos, montar vendas,
distribuir pagamentos mistos e dividir a conta. O app é mobile-first e pode ser
instalado como PWA.

## Desenvolvimento local

Na raiz do repositório, instale as dependências uma vez e inicie o Worker local:

```sh
pnpm install
pnpm dev:pdv
```

O servidor local usa `http://127.0.0.1:3002`. `GET /api/health` verifica se
este app está ativo. O app exige login compartilhado com o ERP e encaminha as
rotas de autenticação ao backend pelo Service Binding.

## Operação offline

Depois de carregar o catálogo online, o PDV conserva catálogo, rascunho e fila
no IndexedDB. Uma venda confirmada entra na fila local antes de o rascunho ser
limpo. A sincronização envia operações em ordem quando a conexão retorna e
mostra pendências, duplicatas e conflitos em **Histórico**. O service worker
guarda apenas o shell e ativos públicos; respostas de API não são cacheadas.

Cada operação inclui usuário, dispositivo, instantes, versão do catálogo e hash
canônico. A API valida catálogo, pagamentos e taxas, e grava venda, itens,
pagamentos e ledger atomicamente. Reenvios usam o mesmo identificador; vendas
iguais no mesmo dispositivo em intervalo menor que 15 segundos são rejeitadas.
Cancelamentos e correções de pagamentos acrescentam registros de auditoria sem
alterar a venda original. Consulte o [protocolo de sincronização](../../docs/protocolo-sincronizacao-pdv.md).

## Stack

- TanStack Start, com TanStack Router e rotas/handlers server-side.
- TanStack Query com integração SSR por instância de router.
- TanStack Form para os formulários do fluxo de venda.
- Cloudflare Vite plugin e Wrangler para desenvolvimento local e futuros
  ambientes preview/produção.

## Verificações

```sh
pnpm format:check:pdv
pnpm lint:pdv
pnpm typecheck:pdv
pnpm test:pdv
pnpm build:pdv
```

## Pacote nativo em desenvolvimento

`pnpm --filter @sabores/pdv mobile:prepare` gera o cliente em `dist/native`,
sem handlers do Worker. `mobile:sync:android` e `mobile:sync:ios` copiam os
arquivos para os projetos Capacitor. O build web permanece separado.

O pacote abre a tela de acesso localmente, mas o transporte autenticado entre
WebView, Cloudflare Access e backend ainda não está implementado. A compilação
do pacote não comprova login ou operação offline em aparelho real.

O backend de negócio é compartilhado com o ERP e tem o único acesso ao D1. A
tela de login protege o conteúdo e a API valida a sessão em todas as rotas de
dados. O navegador não recebe credenciais internas. O SQLite do sistema Python
legado é independente e não sincroniza com D1.

Consulte [a arquitetura web](../../docs/arquitetura-web.md) para as decisões de
backend, bibliotecas e ambientes.
