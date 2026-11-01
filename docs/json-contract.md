# Contrato JSON do sistema Python legado

> Este contrato pertence à importação/exportação do aplicativo Python. Ele não
> é o protocolo da futura API web e não sincroniza o SQLite local com o D1.
> Para a arquitetura planejada dos apps web, consulte
> [arquitetura-web.md](arquitetura-web.md).

O app exporta e importa somente os dados editáveis de operação. Os lançamentos financeiros (`entries`: vendas, compras e gastos) **não fazem parte do arquivo**. A importação nunca limpa, substitui ou reescreve o ledger SQLite.

## Envelope obrigatório

```json
{
  "schema": "sabores-da-canastra/config",
  "schema_version": 1,
  "exported_at": "2026-11-01T12:00:00-03:00",
  "preserve_ledger": true,
  "ingredients": [],
  "recipes": [],
  "products": [],
  "daily_mix": [],
  "parameters": {}
}
```

`schema` e `schema_version` têm que corresponder exatamente. O app valida o documento inteiro e faz as alterações numa transação. Se houver erro, nenhuma alteração do arquivo é aplicada. Chaves ausentes em arrays de configuração são tratadas como lista vazia, mas nenhum registro existente é apagado por estar ausente: importação é **upsert**, nunca sincronização destrutiva. Remoções devem ser feitas explicitamente na interface.

## Ingredientes

Campos: `name` (único), `base_unit` (`g`, `ml`, `un`), `pack_quantity` (string ou número positivo, na mesma unidade-base), `pack_price_cents` (inteiro ou `null`), `supplier`, `price_date` (`YYYY-MM-DD` ou `null`), `price_status` (`Confirmado`, `Estimado`, `Pendente`, `Desatualizado`), `source`, `notes`.

Não transforme uma estimativa em cotação confirmada sem fonte e data reais.

## Produtos

`product_id` (código interno único), `barcode` (código de barras opcional e único), `auxiliary_code` (código auxiliar opcional e único), `name`, `category` (`Salgados`, `Bebidas`, `Doces`, `Molhos`, `Porções`, `Lanches`, `Pizzas`, `Outros`), `unit`, `sale_price_cents` e `unit_cost_cents` (centavos ou `null`), `active` (boolean), `notes`. O PDV localiza por código interno, código de barras, código auxiliar ou nome; a categoria pertence ao cadastro do produto e não é escolhida na venda. Produtos podem não ter receita, por exemplo refrigerantes, doces comprados ou molhos vendidos em frasco.

## Receitas

Cada receita contém `recipe_id` (único), `product_name`, `version` (`E`, `R`, `Única` ou texto), `yield_units` (inteiro positivo), `source`, `instructions` e `lines`. Toda linha de `lines` requer `ingredient_name` presente em `ingredients`, `quantity` (não negativa), `unit` igual à unidade-base do ingrediente e opcional `stage`.

## Mix e parâmetros

`daily_mix` tem `recipe_id`, `quantity` (inteiro não negativo) e `selected_version` (`E` ou `R`). `parameters` é um objeto cujos valores têm `value`, `unit` e `status`.

## Exemplo mínimo

```json
{
  "schema": "sabores-da-canastra/config",
  "schema_version": 1,
  "exported_at": "2026-11-01T12:00:00-03:00",
  "preserve_ledger": true,
  "ingredients": [{"name":"Farinha","base_unit":"g","pack_quantity":"1000","pack_price_cents":750,"supplier":null,"price_date":null,"price_status":"Estimado","source":null,"notes":null}],
  "recipes": [{"recipe_id":"PAO_E","product_name":"Pão salgado","version":"E","yield_units":10,"source":null,"instructions":"","lines":[{"ingredient_name":"Farinha","quantity":"500","unit":"g","stage":"Massa"}]}],
  "products": [{"product_id":"pao-salgado","barcode":null,"auxiliary_code":"SAL-001","name":"Pão salgado","category":"Salgados","unit":"un","sale_price_cents":700,"unit_cost_cents":null,"active":true,"notes":null}],
  "daily_mix": [{"recipe_id":"PAO_E","quantity":5,"selected_version":"E"}],
  "parameters": {"days_month":{"value":"20","unit":"dias","status":"Estimado"}}
}
```

O app oferece botões **Exportar JSON** e **Importar JSON** no topo. Guarde uma cópia do JSON antes de edição em massa; confirme o diff manualmente, especialmente preços, quantidades e rendimentos, antes da importação.
