# ADR: distribuição de catálogo por hub LAN

Estado: proposto; transporte não autorizado para produção até homologação física.
Data: 2026-11-02.

## Contexto observado

O PDV persiste catálogo, rascunho, sessão com expiração e operações no IndexedDB
em `apps/pdv/src/offline/store.ts`. O envio direto para a API continua sendo o
caminho de vendas. `packages/pdv-sync/src/index.ts` define `pdv-op/v1`;
`apps/api/src/pdv-operations.ts` valida e registra os efeitos em D1.

O ERP consulta sessão online em `apps/erp/src/auth-gate.tsx`. Produtos em
`apps/erp/src/prototype/pages.tsx` são exemplos estáticos: não há edição real,
fila de catálogo, sessão offline ou service worker do ERP. Esses recursos são
pré-requisitos, não capacidades existentes. A última migração inspecionada é
`0007_sale_catalog_discrepancies.sql`; futuras migrações devem ser aditivas.

## Topologias consideradas

| Opção | Benefício | Limitação | Decisão |
| --- | --- | --- | --- |
| Hub dedicado persistente | Opera sem internet e sobrevive aos clientes | Exige manutenção, TLS e energia | Candidato preferido |
| Computador do operador como hub | Reutiliza equipamento | Suspensão e desligamento interrompem distribuição | Alternativa gerenciada |
| Comunicação entre abas ou dispositivos | Dispensa servidor dedicado | Não oferece autoridade persistente; descoberta e conexão frágeis | Descartada como base |
| Somente API Cloudflare | Mantém operação simples | Não distribui alterações durante isolamento da internet | Manter como caminho central |

## Decisão condicionada e homologação

Candidato: serviço Node.js LTS com SQLite transacional em volume persistente,
WAL e migrações controladas, iniciado por systemd em máquina Linux dedicada.
Proxy TLS na porta 443, hostname configurável manualmente e certificado confiável
nos dispositivos. Instalação deve fixar versões e verificar integridade dos
artefatos. Descoberta automática será opcional; nunca selecionar um hub apenas
por anúncio na rede. Associação inicial online vincula usuário, dispositivo e
hub após confirmação explícita da identidade do hub.

Não implementar transporte antes de testar dois dispositivos físicos. Matriz
mínima proposta: Chrome Android, Safari iOS em aba e PWA instalada, Firefox e
Edge desktop, registrando versões e sistemas reais. Testar permissões concedidas,
negadas e revogadas, certificado inválido/expirado, DNS sem internet, reinício da
PWA, preflight CORS, CSP, firewall e isolamento de clientes Wi-Fi. Nenhum desses
testes foi executado neste ambiente; não há compatibilidade homologada.

HTTPS não elimina permissões de rede local. Chrome documenta controle próprio
de acesso LAN e exceções específicas de conteúdo misto; elas não constituem
contrato entre navegadores. Não haverá fallback HTTP nem envio de credenciais
em claro. CORS deve aceitar somente origens ERP/PDV configuradas, com métodos e
cabeçalhos explícitos e `Vary: Origin`. CSP deve permitir somente o endpoint TLS
associado em `connect-src`, sem curingas LAN. O hub valida Origin também nas
mutações e aplica limites por dispositivo, tamanho e frequência.

Fontes consultadas em 2026-11-02:

- [Chrome: acesso à rede local](https://developer.chrome.com/blog/local-network-access).
- [MDN: acesso à rede local](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access).
- [MDN: conteúdo misto](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content).
- [MDN: contextos seguros](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).

## Contrato e autoridades

Criar contrato separado `catalog-op/v1`, sem reinterpretar hashes `pdv-op/v1`.
Envelope imutável contém versão do contrato/hash, operationId, hubId, deviceId,
actorUserId, sequência de origem, productId, versão-base, dependências, valores
anteriores/propostos, instante declarado e payloadHash. Valores monetários são
centavos inteiros seguros. Canonicalização e vetores compartilhados precisam
ser definidos e testados antes de habilitar produtores. Hash cobre o envelope
sem o próprio hash; tentativas, estados e recibos ficam fora dele.

Estados distintos: persistida localmente, recebida pelo hub, aplicada
provisoriamente no PDV, confirmada centralmente, conflito, bloqueio de autorização
e rejeição de versão. Sequência do hub não representa revisão D1. Timestamp do
cliente nunca escolhe vencedor. Hash não autentica o autor.

Cada autoridade grava efeito e recibo idempotente na mesma transação. Mesmo ID e
conteúdo devolvem recibo; conteúdo diferente gera conflito. Recibos duráveis não
são descartados por idade enquanto backups ou filas puderem reapresentar IDs.
Retenção só pode ser reduzida com um protocolo explícito de aposentadoria de
origens e rejeição de épocas antigas.

## Identidade delegada

D1 permanece autoridade de usuários e sessões. Provisionamento online emite
credencial assinada com audiência, hub, usuário, dispositivo, escopos, identificador
e expiração de no máximo oito horas, limitada pela sessão central. Hub valida
assinatura por chave pública e mantém identidade própria para a API. Não copiar
cookies, senhas ou hashes. Não colocar credenciais em URL, logs ou backups.

Rotação publica identificadores de chaves; chaves desconhecidas bloqueiam novas
mutações até atualização online. Logout bloqueia captura e preserva filas por
identidade. Revogação conhecida bloqueia imediatamente; revogação central
inacessível pode permanecer desconhecida até expiração. Não renovar offline.
Após reinício sem relógio confiável, bloquear captura até obter referência
central autenticada; detectar retrocesso pelo último horário confiável persistido.

A API exige autorização atual para reconciliação. Operações tardias ou de uma
credencial revogada ficam bloqueadas para revisão e nova autorização explícita;
timestamp declarado não prova autorização passada. Reautenticação não altera
autoria nem envelope original.

## Persistência e distribuição

ERP precisa de shell público cacheável, sem respostas autenticadas no cache,
e dados IndexedDB isolados por usuário. Operação, sequência e projeção são uma
transação; confirmar visualmente somente em `oncomplete`. Abort, quota ou formato
incompatível mostram erro sem sucesso falso. Coordenar abas por transações e
lease persistente; Web Locks é apenas otimização.

Hub confirma após commit de operação, recibo e outbox. Reinício retoma outbox,
FIFO por origem e dependências por produto, com backoff exponencial e jitter.
Feed persistente usa cursor e detecta lacunas; snapshot consistente inclui cursor
da mesma visão. Notificações avisam de mudanças, sem substituir o feed.

PDV grava produtos, revisão e cursor atomicamente antes de confirmar ao hub.
Reentrega não regride revisão. Separar projeção central de overlay LAN provisório;
refresh central/ETag não apaga overlay. Carrinho pede revisão explícita da diferença
de preços. Venda registrada preserva snapshot e referência à operação/revisão LAN;
essa evolução exige versão compatível e validação central antes da ativação.

Sem hub, preservar fila no dispositivo e manter vendas diretas atuais. Indicadores
separam disponibilidade da API e do hub, fila local, fila do hub e confirmação D1.
`navigator.onLine` não demonstra disponibilidade de nenhum serviço.

## Reconciliação e recuperação

D1 aplica versão-base e dependências com recibo e efeito atômicos, compartilhados
por todos os caminhos. Concorrência preserva propostas e base; resolução é nova
operação com autor, motivo e referências. Cadeias offline aguardam dependências.
Produto removido ou inativo mantém tombstone para impedir ressurreição por backup.
Catálogo gera auditoria própria, sem lançamento financeiro artificial.

Recibos e conflitos retornam a hub, ERP e PDV. Preço provisório rejeitado não
reescreve venda nem ledger: preservar venda e divergência auditável. Transporte
futuro de vendas pelo hub deve reutilizar IDs e a mesma idempotência central do
envio direto; não habilitar dois caminhos independentes.

Backup usa snapshot consistente SQLite, inclui recibos, outbox e cursores e exclui
segredos. Restauração deve preservar identidade/época e impedir reaplicação de
efeitos. Instalação precisa documentar TLS/renovação, associação, firewall,
energia, atualização reversível e restauração ensaiada. Armazenamento do navegador
pode ser descartado pelo usuário ou sistema; solicitar persistência não garante
retenção. Expor idade, tentativas, erros e conflitos e nunca apagar pendências
silenciosamente.

## Critérios para implementação e entrega

Após homologação LAN, implementar contrato e autenticação; depois fila ERP/hub,
feed PDV e reconciliação. Cada etapa exige testes negativos e regressivos:

- Dois dispositivos: ERP offline persiste preço e PDV confirma revisão provisória.
- Internet/LAN isoladas, restabelecidas e hub reiniciado antes/depois do commit.
- Resposta perdida, duplicação, reordenação, lacunas e snapshot com cursor.
- Concorrência, cadeia offline, tombstone, fila antiga e relógio divergente.
- Expiração, revogação, ator divergente, reautenticação e assinatura/audiência/escopo inválidos.
- IndexedDB indisponível, quota, corrupção, upgrade parcial e backup restaurado.
- Regressão de vendas, replay, pagamentos, cancelamentos e ajustes diretos.

Esta entrega registra a decisão proposta; não implementa nem valida transporte.
Basear implementação na integração confirmada do PR #21; se ainda aberto, usar
PR empilhado. Referências de contexto, sem fechamento automático: #1
(guarda-chuva), #6 (backend), #17 (offline), #8 (interface) e #10 (operação).
Publicação e revisão remotas ficam com o sistema responsável. A futura solicitação
de full review deve reunir walkthrough, relações e comando num único comentário.
