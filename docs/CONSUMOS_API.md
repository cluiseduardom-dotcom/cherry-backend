# API de Consumo de insumos (#150 fatia 1c)

Base: `/consumos`. **Admin e estoquista** (vendedor = 403). `empresa_id` sempre do JWT. Insumo só sai do **Central**; estoque
nunca fica negativo; nada é apagado (retirar = devolver ao Central por movimentação auditada). Valores de custo só vêm para
quem tem a capacidade `ver_custos` (sem ela, os campos `custo*` não existem na resposta).

Motivos: `consumo_venda` (automático), `substituicao`, `uso_interno`, `perda`, `brinde`, `outro`.

## Insumos
`GET /consumos/insumos` — insumos ativos: `{ id, sku, nome, unidade, saldo_central, custo? }`. Para escolher o item pelo SKU.

## Consumo avulso (sem venda)
- `POST /consumos/avulsos` — `{ produto_id, quantidade, motivo: uso_interno|perda|brinde|outro, responsavel_id?, finalidade?, observacao? }`.
  `uso_interno` **exige** `finalidade` (para quê). `responsavel_id` = quem retirou (padrão: quem lançou; precisa ser usuário ativo da empresa).
  Baixa do Central (movimentação `Consumo avulso #N (motivo)`); sem saldo → **409**, nada é gravado.
- `GET /consumos/avulsos?de&ate&produto_id&motivo&page&pageSize` — histórico (quem retirou, para quê, quando).

## Consumo por venda (só venda **finalizada**)
- `GET /consumos/vendas/:vendaId` — `{ venda, linhas: [{ id, produto_id, sku, nome, origem, quantidade_prevista, quantidade_baixada, quantidade_pendente, estado, observacao, devolvido_em, devolucao_tipo }] }`.
  `estado`: `ativa` | `pendente` (falta baixar) | `retirada` | `cancelamento`.
- `POST /consumos/vendas/:vendaId/linhas` — acrescenta `{ produto_id, quantidade, motivo: brinde|substituicao|outro, observacao? }`.
  Mesma regra da venda: baixa o que houver de saldo e deixa pendência (não bloqueia). Responde `{ linha, pendencias }`.
- `PATCH /consumos/vendas/:vendaId/linhas/:consumoId/retirar` — retira a linha (ex.: vendeu sem a embalagem): o baixado volta ao Central
  (`Retirada consumo venda #N`) e a linha fica `retirada`. Linha já devolvida → 409.
- `PATCH /consumos/vendas/:vendaId/linhas/:consumoId/regularizar` — depois de repor o insumo, baixa a pendência (até o saldo do Central).
  Sem pendência ou sem saldo → 409.

Cancelar a venda devolve só o que ainda não tinha sido devolvido (linha retirada não volta duas vezes).

## Substituição em lote na ficha de venda
- `GET /consumos/substituicoes/previa?de_insumo_id=X` — `{ insumo, afetados: [{ ficha_venda_id, produto_id, sku, nome, quantidade }] }`.
- `POST /consumos/substituicoes` — `{ de_insumo_id, para_insumo_id }`: cada ficha **vigente** que usa X ganha uma **nova versão** com Y no lugar
  (mesma quantidade; se Y já estava na ficha, as quantidades somam; máx. 1000 por venda). Substituto deve ser insumo ativo. Vendas antigas
  mantêm o snapshot. Responde `{ afetados: [{ produto_id, sku, nome }] }` (vazio se ninguém usa X).

## Relatório de consumo e custo (competência)
`GET /consumos/relatorio?de=AAAA-MM-DD&ate=AAAA-MM-DD&produto_id&motivo` — por insumo e motivo: `{ produto_id, sku, nome, motivo, quantidade, custo_total? }`
mais `totais: { por_motivo: [...], custo_total? }`. Soma o consumo das vendas (baixado e **não devolvido**) e o avulso, valorizado pelo custo **da época**.
Datas pelo fuso America/Sao_Paulo. **A compra do insumo não entra** (compra = caixa; consumo = custo; somar os dois duplicaria o gasto).

## Banco (migration 070)
`venda_consumos`: `origem` aceita `brinde|substituicao|outro`; novas colunas `observacao`, `criado_por`, `devolucao_tipo` (`cancelamento|retirada`),
`devolvido_por`. Nova `consumos_avulsos` (FKs compostas com `empresa_id`).
