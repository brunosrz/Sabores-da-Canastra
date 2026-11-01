# Instruções para agentes

Este arquivo se aplica ao repositório inteiro. Instruções específicas em
`apps/erp/AGENTS.md` e `apps/pdv/AGENTS.md` complementam estas regras quando o
trabalho estiver nesses aplicativos.

## Pull requests

- Use branches `feat/`, `fix/` ou `chore/`, com nomes formais e sem números de
  issues ou o termo `codex`.
- Escreva títulos e corpos de PR em português. Todo PR deve ter um corpo com
  resumo, validação e referências às issues relacionadas.
- Quando o PR implementar uma issue, inclua `Closes #N` no corpo para que ela
  seja fechada ao integrar o PR. Referencie issues relacionadas sem fechá-las
  quando o trabalho não as concluir.

## Revisão completa pelo CodeRabbit

Sempre que solicitar `@coderabbitai full review`, publique **antes** um
walkthrough escrito pelo agente como comentário no PR. Não peça ao CodeRabbit
para inventar o walkthrough nem dispare a revisão antes de fornecer esse
contexto.

O walkthrough deve ser específico ao PR e conter:

1. **Objetivo e limites:** issue implementada, comportamento esperado e o que
   está fora do escopo.
2. **Fluxo de execução/dados:** etapas principais na ordem em que ocorrem,
   incluindo entradas, validação, persistência e respostas/efeitos.
3. **Mapa do código:** arquivos centrais e a responsabilidade de cada um.
4. **Invariantes e riscos a revisar:** regras de negócio, segurança,
   idempotência, concorrência, reversão/rollback, compatibilidade e regressões
   relevantes ao trabalho.
5. **Validação:** testes e checks executados, além de limitações do ambiente.
6. **Relações com issues:** links para o guarda-chuva, issue atual, dependências
   abertas ou fechadas já entregues e próximas issues relacionadas. Diga qual é
   a relação de cada uma e não dê a entender que uma issue foi concluída quando
   apenas é dependência ou trabalho futuro.

Depois de publicar o walkthrough, faça um comentário separado no PR começando
com `@coderabbitai full review`. Peça revisão do diff inteiro em relação à
branch base, referencie o walkthrough publicado e solicite achados em
português. Confirme que o bot reconheceu a solicitação e acompanhe o estado da
revisão. Se novos commits alterarem materialmente o escopo, atualize o
walkthrough e solicite outra revisão completa.
