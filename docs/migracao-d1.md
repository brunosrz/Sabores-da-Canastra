# Migração do SQLite e Excel para D1

O utilitário Python continua sendo a ferramenta de compatibilidade para a base
legada. Ele lê o SQLite em modo somente leitura e a planilha, valida os
registros, concilia valores e gera o contrato versionado
`sabores-da-canastra/d1-import` v1. A exportação nunca altera as fontes.

## Revisar antes de importar

```powershell
uv run sabores prever-migracao-d1 `
  --sqlite "$env:USERPROFILE\.sabores-da-canastra\sabores.db" `
  --excel .\sabores_da_canastra_custos_salgados.xlsx `
  --relatorio .\artifacts\preflight-d1.json
```

Para comparar a origem atual com um pacote anterior:

```powershell
uv run sabores prever-migracao-d1 `
  --sqlite .\sabores.db `
  --excel .\sabores_da_canastra_custos_salgados.xlsx `
  --comparar-com .\artifacts\migracao-anterior.json `
  --relatorio .\artifacts\comparacao-d1.json
```

Quando o relatório indicar `valid: true`, exporte o pacote revisável:

```powershell
uv run sabores exportar-migracao-d1 `
  --sqlite .\sabores.db `
  --excel .\sabores_da_canastra_custos_salgados.xlsx `
  --saida .\artifacts\d1-import-v1.json `
  --relatorio .\artifacts\export-d1.json
```

O relatório inclui hash SHA-256, tamanho e metadados das fontes, instante em
UTC, fuso operacional, contagens e conciliação de vendas, compras e gastos.
O hash de proveniência não substitui a integridade do contrato: o servidor
recalcula o hash dos dados antes de qualquer escrita.

## Preview e gravação local

O endpoint de importação local só fica disponível em `localhost`/`127.0.0.1`,
exige token efêmero e aceita no máximo 5 MB. Com o Worker e o D1 local em
execução, envie primeiro o pacote para `POST /__local/import?mode=preview`.
O resultado classifica o destino como `empty`, `already_imported` ou
`occupied` e não escreve dados. A gravação é uma ação separada em
`POST /__local/import`; pacotes repetidos são idempotentes e bancos ocupados
com outro identificador são recusados, sem mesclagem destrutiva.

Operações financeiras do PDV usam uma rota distinta, autenticada e online/offline:
`POST /api/pdv/operations`. Cada operação mantém seu envelope e hash para
retry, decisão de duplicata e auditoria no ledger.

## Regras do contrato

- Valores financeiros são centavos inteiros em BRL.
- Cada venda precisa conciliar itens, pagamentos, taxa e líquido.
- O destino vazio é importado em um único batch transacional; banco ocupado
  não é sobrescrito nem mesclado.
- O mesmo `import_id` retorna “já importado” sem criar registros de novo.
- Migrações SQL são aditivas e versionadas; o ledger e seus snapshots não são
  reescritos.
- Nunca inclua token Cloudflare, sessão ou credencial no pacote JSON ou no
  relatório.
