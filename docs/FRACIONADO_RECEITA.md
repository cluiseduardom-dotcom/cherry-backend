# Fracionado, etapa 1: receita com rendimento (unidade-base inteira)

Decisão do PO (21/11/2026): **quantidades continuam inteiras no banco**. Produto fracionado guarda o estoque na menor unidade
(gramas, ml) e a tela converte para kg/L. Nenhuma coluna de quantidade vira decimal; o que muda é a receita e a precisão do **custo**.
Migration 124 (`docs/FRACIONADO_RECEITA.md`), regras em `src/utils/receita.js`.

## Unidades
`produtos.unidade` aceita também `G` (grama) e `ML` (mililitro). `KG` e `L` **não** existem no banco: são só conversão da tela
(1 kg = 1000 G). Ex.: leite condensado em `G`, com custo R$ 12,50/kg = R$ 0,0125 por grama.

## Custo com mais casas
`produtos.custo`, `itens_compra.custo_unitario`, `itens_venda.custo_unitario` e os custos congelados de consumo
(`venda_consumos`, `consumos_avulsos`) passam de `NUMERIC(10,2)` para `NUMERIC(14,6)`. Ampliação sem perda: `12.50` vira `12.500000`.
O preço de venda (2 casas) não muda. O cadastro de produto já aceitava mais casas e arredondava em silêncio para 2: agora guarda.

## Receita com rendimento (`fichas_tecnicas.rendimento`, padrão 1)
`POST /produtos/:id/ficha-tecnica` aceita `rendimento` (inteiro de 1 a 1.000.000). A quantidade de cada insumo passa a ser
**por receita**; o rendimento diz quantas unidades do acabado essa receita rende.

| Regra | Fórmula |
|---|---|
| Consumo de `N` unidades de um insumo | `ceil(quantidade × N ÷ rendimento)` |
| Máximo produzível por um insumo | `floor(saldo × rendimento ÷ quantidade)` (o inverso exato da regra acima) |
| Custo da receita / por unidade | `Σ quantidade × custo` / `÷ rendimento` |

Arredonda **para cima**: nunca se registra menos insumo do que se gastou (diferença de até 1 unidade-base por insumo e por ordem).
Com rendimento 1 tudo coincide com o comportamento anterior (`consumo por unidade × N`).

A resposta da ficha traz `rendimento`, `custo_receita` e `custo_sugerido` (por unidade, 4 casas); estoquista não recebe custo.

## Onde a regra vale
`GET /producoes/necessidade`, ordens de produção (planejado, baixa na conclusão, pendência de insumo), `POST /producoes`
(produção imediata, inclusive detalhe e cancelamento, que devolve exatamente o consumido). A necessidade e a ordem trazem
`rendimento`, e cada insumo `quantidade_receita` (por receita), `por_unidade` (média) e `necessario` (consumo real).

## Fora desta etapa
Venda por peso no PDV (vender 0,350 kg a preço por kg), conversão kg/L nas telas de estoque e compra, e a tela da receita com
rendimento (frontend). Não há KG/L no banco por decisão.
