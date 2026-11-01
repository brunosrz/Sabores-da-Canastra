# Metodologia financeira e de dados

## Fonte autoritativa e atualização

As entradas editáveis são mantidas no Excel. Python lê os parâmetros para validar relações e executar cálculos monetários com `Decimal`; a planilha mantém as fórmulas Excel editáveis. `openpyxl` grava fórmulas, mas não as executa, portanto o recálculo de fórmulas precisa acontecer ao abrir no Excel ou LibreOffice. O programa configura recálculo completo na abertura e não substitui valores de entrada por dados calculados.

`py -m sabores inspecionar` lista abas, dimensões, fórmulas, tabelas, validações e gráficos. `py -m sabores validar` verifica parâmetros, somas de formas de pagamento, unidades/cadastros/referências e mix. `py -m sabores simular` calcula a referência financeira a partir da aba Parametros.

## Fórmulas

- Custo normalizado por unidade-base: `preço do pacote / quantidade do pacote`.
- Custo utilizado na receita: `custo normalizado × quantidade utilizada`.
- Custo por unidade de receita: `custo total do lote / rendimento observado ou estimado`.
- Lotes necessários: `ceil(quantidade solicitada / rendimento por lote)`. Excedentes continuam em estoque se registrados; não são automaticamente considerados perda.
- Gasolina: `quilômetros / km por litro × preço por litro`.
- Taxa média: `participação débito × taxa débito + participação crédito × taxa crédito + outras formas × respectivas taxas`. As participações não podem exceder 100%.
- Resultado de referência: faturamento - custo agregado de refrigerantes - gasolina - taxas de pagamento. Ele exclui todos os custos dos salgados e outros gastos, portanto não representa lucro.
- Compra: necessidades somadas por ingrediente; estoque existente é descontado e a quantidade de pacotes é arredondada para cima. Desembolso por pacote não se confunde com consumo contábil do ingrediente.

Não arredondar taxas intermediárias. Arredondar para centavos apenas na apresentação.

## Referências de operação inicial

25 salgados × R$ 7 e 20 latas × R$ 6 resultam em R$ 295 por dia. Em 20 dias de venda: R$ 5.900 de faturamento, R$ 1.400 de custo agregado de lata (20 × R$ 3,50 × 20 dias), R$ 77 de gasolina mínima e R$ 88,55 com 15% de folga. Taxa efetiva é 1,1825% e totaliza R$ 69,7675, exibidos como R$ 69,77. Saldos de referência: R$ 4.353,23 e R$ 4.341,68, respectivamente.

O valor de R$ 3,50 por lata inclui R$ 3,00 aproximados de compra e R$ 0,50 de refrigeração. Ajustar o componente agregado uma única vez para evitar duplicidade.

## Status de dados e pesquisas

Use `Confirmado`, `Estimado`, `Pendente` e `Desatualizado`. Para cotação, exija preço não promocional claramente verificável, quantidade da embalagem, data, fornecedor e URL ou evidência de televendas. Preço promocional não participa de preço normal ou média. Sem evidência, preço fica em branco. Valores atualmente em Insumos são herdados da planilha e permanecem explicitamente estimados.

Fontes públicas consultadas em 01/11/2026:

- Economart Passos: https://economart.com.br/loja/economart-passos/ — confirma endereço/unidade; página de ofertas https://economart.com.br/ofertas/ mostra campanhas promocionais. O próprio canal de contato diz que preços podem ser consultados por televendas/jornais: https://economart.com.br/contato/.
- Mart Minas: https://www.martminas.com.br/duvidas-fale-conosco/ — informa consulta de preços por televendas ou jornais de ofertas; não foi obtida cotação regular aberta verificável.
- ABC Atacado e Varejo Passos: https://www.abcatacadoevarejo.com.br/pages/lojas — confirma unidade, endereço e televendas; não foi obtida cotação regular pública dos ingredientes.
- Receitas Nestlé — esfiha de carne: https://www.receitasnestle.com.br/receitas/esfiha-de-carne (a página consultada informa rendimento de 60 porções e detalha ingredientes; ficha comercial do Excel continua hipótese diferente).
- Receitas Nestlé — enroladinho para vender: https://www.receitasnestle.com.br/receitas/receita-enroladinho-salsicha-para-vender (cerca de 40 unidades pequenas ou 20 médias, com receita publicada).
- Fleischmann — enroladinho de calabresa: https://www.fleischmann.com.br/receita/enroladinho-de-calabresa/ (ingredientes e preparo; página não informa rendimento na captura consultada).
- Referências Sebrae e receitas adicionais já constam na aba Fontes; as quantidades comerciais continuam devendo ser aferidas pela família.

## Limitações de segurança e operação

O projeto não determina validade nem substitui orientação sanitária. Regras de congelamento, cadeia de frio, preparo, alergênicos, rotulagem e conservação devem ser validadas conforme a receita e a forma de venda. O cadastro de lote/validade é para ajudar o registro, não para declarar prazo seguro. Tributo zero e trabalho zero são lacunas configuráveis, nunca afirmações de isenção ou ausência de custo.
