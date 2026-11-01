# Sabores da Canastra ERP

Aplicação web independente para cadastro e gestão operacional/financeira. O
bootstrap prepara a base; os fluxos de ERP serão implementados nas próximas
etapas.

## Desenvolvimento local

Na raiz do repositório, instale as dependências uma vez e inicie o app:

```sh
pnpm install
pnpm dev:erp
```

O servidor local usa `http://127.0.0.1:3001`. O endpoint `/api/health` permite
verificar o Worker local.

## Stack

- TanStack Start, com TanStack Router e rotas/handlers server-side.
- TanStack Query com integração SSR por instância de router.
- TanStack Form para formulários e TanStack Table para grades de cadastro e
  relatórios nas etapas de produto.
- Cloudflare Vite plugin e Wrangler para desenvolvimento local e futuros
  ambientes preview/produção.

Não configure recursos Cloudflare remotos nem publique sem a etapa de
infraestrutura correspondente.
