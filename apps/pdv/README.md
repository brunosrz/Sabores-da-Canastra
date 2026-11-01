# Sabores da Canastra — Cloudflare

Aplicação web independente do app Python. Este scaffold prepara uma SPA em React/Vite e uma API Hono executada no Cloudflare Workers Runtime.

## Requisitos

- Node.js 22.12 ou superior
- pnpm 12.11.2 (ou compatível com o lockfile)

## Comandos

Execute-os dentro de `apps/cloudflare`:

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm preview
pnpm lint
pnpm typecheck
pnpm test
pnpm cf-typegen
```

O desenvolvimento e os testes usam bindings locais do Wrangler/Miniflare. Nenhuma credencial Cloudflare é necessária, e nenhum recurso remoto é conectado por padrão.

## Rotas iniciais

- `GET /api/health`: verificação de saúde da API Hono.
- `/pdv` e `/gestao`: telas placeholder da SPA; os hosts `pdv.*` e `gestao.*` também selecionam cada aplicação.
- Qualquer outra rota de navegação recebe o fallback `index.html` da SPA.

## Ambientes e bindings

`wrangler.jsonc` define os ambientes locais (padrão), `preview` e `production`. Binding `ASSETS` e nomes ambientais são locais e não exigem IDs de contas, tokens, D1, R2 ou outros recursos remotos. Adicione bindings remotos nas próximas issues somente junto com seus recursos e testes locais.

Segredos de desenvolvimento devem ficar em `.dev.vars` ou `.env.local`, que são ignorados pelo Git. Use apenas valores fictícios em arquivos de exemplo.
