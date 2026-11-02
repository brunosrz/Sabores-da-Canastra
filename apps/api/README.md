# API compartilhada e bindings Cloudflare

Worker Hono interno compartilhado por ERP e PDV. O D1 é a fonte de verdade
para catálogo, vendas e ledger; KV é somente cache descartável; R2 guarda
artefatos privados; Durable Objects serializam operações do PDV por dispositivo; Workflows
produzem e retêm backups D1.

## Execução local

Na raiz, instale dependências, copie o arquivo de segredos de exemplo e aplique
as migrations ao D1 local:

```powershell
pnpm install --frozen-lockfile
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
pnpm db:migrate:local
pnpm dev:api
```

Cadastre contas diretamente na tabela privada `users` do D1. O script solicita
os nomes e as senhas no terminal sem ecoar as senhas; esses dados não ficam em
arquivos versionados nem em secrets do Worker:

```powershell
uv run python apps/api/scripts/provision_auth_users.py preview
```

Execute depois de aplicar as migrations ao ambiente desejado. O script grava
um SQL temporário ignorado pelo Git, aplica os hashes no D1 e apaga o arquivo.
Use `local`, `preview` ou `production` como argumento. As senhas precisam ter
de 4 a 128 caracteres; os hashes usam PBKDF2-SHA-256 com 100.000 iterações,
compatível com o WebCrypto dos Workers. O Wrangler executa simuladores
locais de D1, KV, R2, Durable Objects e Workflows. O servidor responde em
`http://127.0.0.1:3000`; nenhum comando de desenvolvimento usa `--remote`.
Ao desenvolver uma tela que chama a API por Service Binding, mantenha também
`pnpm dev:api` em execução; o Vite plugin conecta os Workers locais pelo nome
do serviço.

## Responsabilidade de cada binding

- **D1 (`DB`)**: catálogo financeiro e ledger. Uma operação aceita grava
  ledger, venda, snapshots, itens, pagamentos e recibo de idempotência em um
  único `batch`.
- **KV (`CATALOG_CACHE`)**: somente `catalog:v1:products:active`, TTL de 60 s.
  Guarda identificadores, nomes, categorias, unidades e preço de venda; não
  armazena custos unitários nem dados do ledger. O endpoint autenticado do PDV
  consulta custos e taxas diretamente no D1, sem cache. Falhas de KV retornam
  à leitura D1.
- **R2 (`PRIVATE_FILES`)**: SQL de backup e manifesto JSON. Bucket privado, sem
  domínio público ou `r2.dev`. A lista e o download exigem uma sessão de usuário;
  respostas são `private, no-store`. Escritas são
  condicionais e conteúdo diferente na mesma chave é recusado; download SQL
  valida contrato, tamanho e SHA-256 em streaming antes de entregar o arquivo;
  o SQL é lido duas vezes no R2 para validar primeiro e então responder sem
  carregá-lo inteiro na memória.
- **Durable Object (`SALE_COORDINATOR`)**: serializa operações de um dispositivo
  e encaminha a gravação ao D1. O mesmo `operationId` e hash retorna o recibo;
  reuso com conteúdo diferente retorna HTTP 409. Vendas idênticas do mesmo
  dispositivo em janela estritamente menor que 15 segundos são recusadas.
- **Workflow (`D1_BACKUP`)**: exporta D1 pela API oficial, aguarda com etapas
  retomáveis, verifica SHA-256, salva SQL e manifesto no R2 e remove objetos
  antigos conforme a retenção do ambiente. Produção agenda execução diária às
  06:00 UTC; `POST /api/backups/run` permite execução autenticada manual.
  A API de exportação pode bloquear consultas e gravações no D1 durante a
  operação. A janela configurada é 06:00 UTC e a rota manual deve ser usada
  dentro dessa mesma janela operacional. Confirme que esse horário é fora do
  expediente de vendas antes de ativar o Workflow de produção.

## Ambientes e publicação

O arquivo `wrangler.jsonc` declara bindings próprios para local, preview e
produção. D1, namespace KV, bucket R2 e Workflow têm identificadores/nome
separados em preview e produção. Os recursos de preview já foram provisionados;
produção ainda usa identificadores de exemplo e exige provisionamento separado.
O Worker da API não publica rota `workers.dev` e já está publicado em preview;
ERP e PDV têm Service Bindings internos apontando para o Worker da API no
ambiente correspondente. O nome base
do Worker é exclusivo do ambiente local e não coincide com produção.

Secrets são mantidos em arquivos ignorados pelo Git e enviados em lote pelo SCons.
Copie os exemplos e preencha valores exclusivos para cada ambiente:

```powershell
Copy-Item .env.example .env
Copy-Item apps/api/.env.preview.example apps/api/.env.preview
uv run scons api-preview
uv run scons preview
```

As contas ficam no D1 e não existe cadastro público. Para criá-las ou trocar
credenciais, execute o utilitário de provisionamento após aplicar as migrations
do ambiente. Ele pede a quantidade de contas e os dados em prompts locais; os
nomes não aparecem em código, exemplos versionados ou configuração do Worker.
Use senhas e salts independentes entre preview e produção.

`CLOUDFLARE_API_TOKEN` (no arquivo de secrets da API) deve ter somente a permissão necessária para exportar o D1
correspondente. `BACKUP_DATABASE_ID` precisa ser o mesmo ID de
`d1_databases[0].database_id`; o guard interrompe o deploy se divergirem. Antes
de `scons preview`, habilite Cloudflare Access e proteja os hostnames de preview
com uma política Allow para seu e-mail individual. O SCons verifica a política
e não publica se Access estiver ausente ou contiver regra bypass. A API não tem
rota pública; os apps chamam o Worker por Service Binding.

```powershell
Copy-Item apps/api/.env.production.example apps/api/.env.production
uv run scons prod
```

Os scripts recusam os identificadores de exemplo e verificam que preview e
produção não compartilham D1, KV ou R2. O dry-run de configuração pode ser
conferido sem credenciais com `pnpm build:api` e `wrangler deploy --env preview
--dry-run`.

## Rotas da API

- `GET /health`: disponibilidade do Worker.
- `POST /api/auth/login`: valida usuário na tabela privada `users`, limita
  tentativas por IP e emite cookie HttpOnly compartilhado entre os subdomínios.
- `GET /api/auth/session` e `POST /api/auth/logout`: consultam e revogam a sessão
  opaca, persistida somente como hash no D1.
- `GET /api/catalog/products`: exige sessão autenticada; KV é acelerador
  descartável.
- `GET /api/pdv/catalog`: exige sessão; entrega snapshot do catálogo e taxas
  para armazenamento local do PDV.
- `POST /api/pdv/operations`: exige sessão e origem confiável; aceita criação de
  venda, cancelamento e correção de pagamentos no contrato versionado. Grava
  `actor_user_id` no ledger e eventos compensatórios sem reescrever registros.
- `GET /api/pdv/sales?from=AAAA-MM-DD&to=AAAA-MM-DD`: histórico autenticado,
  com pagamentos vigentes e estado de cancelamento.
- `GET /api/backups`: lista manifestos, exige sessão autenticada.
- `GET /api/backups/file/{chave R2}`: baixa artefato autenticado.
- `POST /api/backups/run`: inicia backup manual autenticado e idempotente.
- `POST /__local/import`: importação local protegida por token e hostname.

Não existe rota de cadastro. O provisionador local cadastra usuários diretamente
na tabela privada `users`, que guarda salt e hash PBKDF2; nenhum nome de usuário
é publicado como variável ou secret do Worker. O cookie tem validade de
12 horas, `HttpOnly`, `SameSite=Strict` e `Secure` fora de localhost. Preview e
produção usam nomes de cookie distintos. Mutations validam a origem somente
contra a lista explícita do ambiente. Há limites de 10 tentativas por IP e por
combinação de IP/usuário, além de 100 por conta, em 15 minutos. D1 armazena os
hashes dos identificadores dos buckets e os contadores da janela; falhas de
credenciais são registradas sem incluir usuário ou senha em claro.

## Backup, retenção e restauração

D1 Time Travel é a primeira opção de recuperação pontual. O Workflow mantém
backups externos diários por 90 dias em produção e 30 dias em preview. Erros
geram falha observável no Workflow/Workers Logs; verifique execução diária,
último manifesto e idade do backup. Alertas de conta ficam pendentes até a
configuração do ambiente Cloudflare.

Para recuperar dados: baixe SQL e manifesto pela API autenticada. A rota de
download valida contrato, tamanho e SHA-256 antes de entregar SQL. Guarde os
dois arquivos localmente e valide também o procedimento de restore isolado:

```powershell
pnpm --filter @sabores/api db:restore:validate -- .local/backup.sql .local/backup.json
```

O comando verifica o contrato/hash e aplica o SQL usando um binding D1 local
dedicado (`sabores-canastra-restore-validation`), sem `--remote` e sem tocar o
D1 operacional local. Depois compare schema, contagens e reconciliação antes
de planejar troca de banco. Não restaure por cima do D1 produtivo sem validar a
cópia. Cada validação usa um diretório temporário novo; o caminho impresso no
final identifica a cópia a comparar. O nome local do SQL pode ser alterado: a
integridade depende do manifesto, tamanho e hash, não do basename. A CI executa
o mesmo procedimento com um fixture sintético.

Para exportar o D1 simulado local sem chamar a API remota, use o comando de
linha de comando abaixo. Ele gera SQL e manifesto adjacente em `.local/backups`;
o fluxo de Workflow de backup usa a API Cloudflare e não exporta o simulador.

```powershell
pnpm --filter @sabores/api db:backup:local
```

## Validação

```powershell
pnpm format:check:api
pnpm lint:api
pnpm typecheck:api
pnpm test:api
pnpm db:migrate:local
pnpm build:api
```

`test:api` executa unitários e testes de bindings Cloudflare em Miniflare. O CI
aplica migrations locais duas vezes para confirmar que a repetição não duplica
schema. Mudanças futuras de schema entram em uma migration versionada nova;
nunca reescreva uma migration aplicada.
