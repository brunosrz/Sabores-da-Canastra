# Protocolo de sincronização do PDV

## Envelope de operação

O cliente e a API usam `@sabores/pdv-sync` como contrato compartilhado. Uma
operação contém `operationId`, `deviceId`, identidade do usuário autenticado,
tipo, instante da venda (`occurredAt`), instante de criação no dispositivo,
versão do catálogo, versão do hash e payload. O `payloadHash` é SHA-256 da
representação canônica do envelope sem o próprio hash. Valores são centavos
inteiros; quantidade e composição de pagamentos são validadas antes do envio e
novamente no servidor.

## Persistência offline e ordem

O PDV grava rascunho, catálogo e operações no IndexedDB. Confirmar uma venda
insere a operação na fila e remove o rascunho na mesma transação. Cada operação
recebe sequência monotônica local; sincronização envia em ordem e para no
primeiro erro que exige login, revisão ou conexão. A API usa um Durable Object
por dispositivo para serializar tentativas concorrentes. Uma resposta aceita
ou uma repetição idempotente atualiza o estado local; não se descarta uma
operação sem confirmação do servidor.

O service worker guarda apenas shell e ativos públicos do aplicativo. Rotas
`/api/` não são armazenadas em cache. O catálogo offline fica no IndexedDB e é
atualizado por uma resposta autenticada quando há conexão.

## Integridade e ledger

O backend verifica usuário autenticado, dispositivo, hash, produto e snapshot
de preço/custo contra o catálogo atual, além dos valores de taxas e da soma dos
pagamentos. Escritas da venda, itens, pagamentos, ledger e operação usam um
batch D1 atômico. Reenvio do mesmo `operationId` e conteúdo retorna o resultado
original. Uma venda com mesmo hash, dispositivo e instante dentro de menos de
15 segundos é registrada como rejeitada por duplicidade; o limite de 15
segundos exato não é duplicata.

Cancelamento e correção de pagamento não apagam nem editam o lançamento
original. São operações auditáveis que acrescentam eventos compensatórios ao
ledger. Pagamentos mistos e divisão da conta mantêm centavos exatos e somam o
total bruto da venda.

## Estados e recuperação

`pending` e `syncing` indicam operação ainda não confirmada; `synced` indica
confirmação; `duplicate` registra rejeição idempotente; `conflict` requer
revisão; `invalid` exige correção dos dados; `auth_required` aguarda novo
login. Problemas transitórios de rede/servidor preservam a posição na fila e
permitem nova tentativa. O histórico mostra vendas sincronizadas e pendências
locais separadamente.

## Migração e contrato legado

O utilitário Python documentado em [Migração do SQLite e Excel para
D1](migracao-d1.md) valida e exporta o formato legado; essa importação é
separada da fila do PDV. O preview não grava. A gravação exige ação explícita,
preserva a origem e é idempotente pelo identificador de importação.
