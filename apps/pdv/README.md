# Sabores da Canastra PDV

Aplicação web independente para operação de ponto de venda. O bootstrap prepara
a base; os fluxos de venda serão implementados nas próximas etapas.

## Desenvolvimento local

Na raiz do repositório, instale as dependências uma vez e inicie o app:

```sh
pnpm install
pnpm dev:pdv
```

O servidor local usa `http://127.0.0.1:3002`. O endpoint `/api/health` permite
verificar o Worker local.

## Stack

- TanStack Start, com TanStack Router e rotas/handlers server-side.
- TanStack Query com integração SSR por instância de router.
- TanStack Form para os formulários do fluxo de venda.
- Cloudflare Vite plugin e Wrangler para desenvolvimento local e futuros
  ambientes preview/produção.

Não configure recursos Cloudflare remotos nem publique sem a etapa de
infraestrutura correspondente.
