# API compartilhada e D1

Worker privado planejado como backend único do ERP e do PDV. Esta etapa cria o
schema inicial, o endpoint de saúde local e a importação inicial do SQLite e
da planilha. Ainda não contém autenticação nem regras de negócio completas,
não está ligado aos frontends e não tem ambiente remoto configurado.

## Banco local

Na raiz, instale dependências e aplique as migrations somente ao D1 local:

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm dev:api
```

A API responde em `http://127.0.0.1:3000/health`. Nenhuma instrução deste guia
usa `--remote`.

## Prévia e pacote de migração

O exportador lê SQLite em modo somente leitura, valida o workbook, combina a
configuração do Excel com a configuração atual do SQLite (SQLite prevalece para
registros coincidentes) e reconcilia contagens e totais. Datas operacionais
permanecem no calendário de `America/Sao_Paulo`; instantes sem fuso no legado
são interpretados nesse fuso e armazenados em UTC. Valores financeiros são
inteiros em centavos.

```powershell
uv run sabores prever-migracao-d1
uv run sabores exportar-migracao-d1 --saida .local/d1-import.json
```

O preview não grava nem altera nenhum banco. O pacote contém dados financeiros
e deve ficar local; `.local/` é ignorado pelo Git. Diferenças ou registros
inválidos interrompem o exportador e são mostrados no relatório.

## Aplicação local e idempotência

Copie `.dev.vars.example` para `.dev.vars` e defina um token aleatório local de
32 caracteres ou mais. Inicie o Worker local, confira o JSON exportado e então
rode:

```powershell
pnpm db:import:local -- .local/d1-import.json
```

O endpoint de importação exige hostname local e token não versionado. Ele não
fica habilitado quando o token não está configurado. Os dados são validados
antes da escrita e aplicados em um único `D1Database.batch`; uma falha reverte
todo o lote. `import_id` e chaves idempotentes tornam repetição do mesmo pacote
um no-op. Se o D1 já contiver dados sem esse `import_id`, a importação é
recusada para evitar mescla ou sobrescrita ambígua.

## Modelo financeiro

- Catálogo: categorias, produtos, códigos e preços/custos em centavos.
- Insumos: ingredientes, cotações datadas e fichas técnicas com unidades-base.
- Operação: vendas, itens e formas de pagamento com taxa e custo unitário
  congelados no momento da venda; compras e despesas.
- `ledger_entries` é append-only. Ajustes devem ser novos registros vinculados
  ao original, com justificativa. Vendas, itens e pagamentos são snapshots
  imutáveis e não devem ser atualizados para corrigir períodos passados.
- `data_imports` guarda contrato, hash, contagens e reconciliação do pacote.

`apps/api/migrations` contém migrations SQL versionadas. A migration inicial
usa `IF NOT EXISTS` em tabelas, índices e triggers para não duplicar objetos se
o schema já estiver presente. Wrangler registra cada migration aplicada em
`d1_migrations`; executar `pnpm db:migrate:local` novamente é um no-op. Mudanças
de schema devem entrar em um novo arquivo versionado e nunca reescrever uma
migration já aplicada. SQLite não implementa `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS`: migrations de coluna devem consultar `PRAGMA table_info(...)` e só
adicionar o campo se ainda não existir. O CI aplica as migrations duas vezes
para conferir a repetição segura.

## Idempotência na infraestrutura Cloudflare

O D1 é a fonte de verdade para operações de negócio. Escritas repetíveis usam
chaves estáveis e restrições `UNIQUE`; eventos financeiros também mantêm a
imutabilidade do ledger. O lote do importador é transacional e um mesmo
`import_id` confirmado retorna sem inserir novamente.

Workers KV e R2 ainda não estão ligados a este Worker. Quando forem necessários:

- KV será usado para cache/configuração descartável. As chaves terão namespace,
  versão e identidade estável; `put` substitui o valor, então não será usado
  como trava ou garantia de execução única. Para estado forte, consultar D1.
- R2 usará chaves determinísticas e `onlyIf` com `If-None-Match: *` para criação
  única; uma repetição deve verificar o objeto/hash existente e responder como
  já concluída, sem sobrescrevê-lo.
- Durable Objects usarão transações de armazenamento para operações atômicas;
  alarmes e consumidores terão identificadores de evento persistidos para
  tolerar execução pelo menos uma vez.
- Recursos Cloudflare serão declarados uma vez no Wrangler/IaC e reutilizados
  por binding. O deploy atualiza o Worker; não se criam namespaces, buckets ou
  bancos por execução.

Essas regras descrevem a integração futura sem declarar bindings ou recursos
remotos que ainda não foram provisionados. Para comandos de validação, veja os
scripts `*:api` e `db:migrate:local` na raiz.
