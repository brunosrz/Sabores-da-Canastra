# Sabores da Canastra ERP

Aplicação web independente para operação administrativa do bar, planejada para
`erp.brunosrz.com`. O bootstrap configura a base técnica; cadastro de produtos,
ingredientes, receitas, estoque, custos e demais fluxos serão entregues em
etapas posteriores. O domínio ainda não está publicado e o app não está ligado
a dados de produção.

## Desenvolvimento local

Na raiz do repositório, instale as dependências uma vez e inicie o Worker local:

```sh
pnpm install
pnpm dev:erp
```

O servidor local usa `http://127.0.0.1:3001`. `GET /api/health` verifica
somente se este app está ativo; não é a futura API de negócio.

## Stack

- TanStack Start, com TanStack Router e rotas/handlers server-side.
- TanStack Query com integração SSR por instância de router.
- TanStack Form para formulários e TanStack Table para grades de cadastro e
  relatórios nas etapas de produto.
- Cloudflare Vite plugin e Wrangler para desenvolvimento local e futuros
  ambientes preview/produção.

## Verificações

```sh
pnpm format:check:erp
pnpm lint:erp
pnpm typecheck:erp
pnpm test:erp
pnpm build:erp
```

O backend de negócio será compartilhado com o PDV e terá o único acesso ao D1.
Este app usará server functions para chamar esse backend por binding interno;
essa integração ainda não foi implementada. O SQLite do sistema Python legado
é independente e não sincroniza com D1.

Consulte [a arquitetura web](../../docs/arquitetura-web.md) para as decisões de
backend, bibliotecas e ambientes.
