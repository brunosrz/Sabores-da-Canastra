# Sabores da Canastra ERP

Aplicação web independente para operação administrativa do bar em
`erp.brunosrz.com`. O esqueleto mobile-first fornece autenticação compartilhada,
tema claro/escuro e navegação inferior para os módulos administrativos que
serão implementados por etapas.

## Desenvolvimento local

Na raiz do repositório, instale as dependências uma vez e inicie o Worker local:

```sh
pnpm install
pnpm dev:erp
```

O servidor local usa `http://127.0.0.1:3001`. `GET /api/health` verifica se
este app está ativo. O app exige login compartilhado com o PDV e encaminha as
rotas de autenticação ao backend pelo Service Binding.

## Stack

- TanStack Start, com TanStack Router e rotas/handlers server-side.
- TanStack Query com integração SSR por instância de router.
- TanStack Form para formulários e TanStack Table para grades de cadastro e
  relatórios nas etapas de produto.
- Cloudflare Vite plugin e Wrangler para desenvolvimento local e futuros
  ambientes preview/produção.

## Pacote nativo em desenvolvimento

`pnpm --filter @sabores/erp mobile:prepare` gera o cliente em `dist/native`,
sem handlers do Worker. `mobile:sync:android` e `mobile:sync:ios` copiam os
arquivos para os projetos Capacitor. O build web permanece separado.

O pacote abre a tela de acesso localmente e possui transporte HTTP nativo para
o domínio do ERP. A autenticação com Cloudflare Access e o backend ainda não
está validada nem configurada para o cliente nativo. A compilação do pacote
não comprova login ou operação offline em aparelho real. Para usar preview no
build, defina `VITE_NATIVE_API_ORIGIN=https://erp-preview.brunosrz.com`.

## Verificações

```sh
pnpm format:check:erp
pnpm lint:erp
pnpm typecheck:erp
pnpm test:erp
pnpm build:erp
```

O backend de negócio é compartilhado com o PDV e tem o único acesso ao D1. A
tela de login protege o conteúdo e a API valida a sessão em todas as rotas de
dados. O navegador não recebe credenciais internas. O SQLite do sistema Python
legado é independente e não sincroniza com D1.

Consulte [a arquitetura web](../../docs/arquitetura-web.md) para as decisões de
backend, bibliotecas e ambientes.
