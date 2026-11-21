# PCP: ordem de produção (PR 2 do módulo)

Funcionalidade `pcp` (todas as rotas abaixo exigem; sem ela, 403). Acesso: admin e estoquista (mesmo alcance de `/producoes`).
Migration 122 (`ordens_producao`). Convive com `producoes` (produção imediata, sem estados), que continua igual.

## Ciclo
`planejada` → `em_producao` → `concluida`; `planejada`/`em_producao` → `cancelada`.

| Rota | O que faz |
|---|---|
| `POST /producoes/ordens` `{ produto_id, quantidade_planejada, prazo?, observacao? }` | cria `planejada`, presa à **ficha técnica vigente** naquele momento. Produto precisa ser `acabado`, ativo e ter ficha |
| `GET /producoes/ordens?status&produto_id&page&pageSize` | lista (mais novas primeiro) |
| `GET /producoes/ordens/:id` | ordem + insumos da ficha congelada (`por_unidade`, `necessario_planejado`, `disponivel`) |
| `PATCH /producoes/ordens/:id/iniciar` | `planejada` → `em_producao` (quem e quando). **Não reserva nem consome estoque** |
| `PATCH /producoes/ordens/:id/concluir` `{ quantidade_produzida, quantidade_perdida? }` | só de `em_producao`. Apontamento real |
| `PATCH /producoes/ordens/:id/cancelar` `{ motivo }` | `planejada` ou `em_producao`; motivo de 3 a 200 caracteres |

## Conclusão (a regra que mexe em estoque)
Numa transação, com a ordem e os insumos travados (insumos em ordem de id):
- cada insumo sai em `(produzida + perdida) × consumo por unidade`: a perda também gastou insumo;
- o acabado entra só com `quantidade_produzida`;
- insumo insuficiente = `409` e **nada é gravado** (a ordem segue `em_producao`); insumo inativo = `400`;
- `custo_insumos` congela o custo dos insumos consumidos naquele momento; `custo_unitario_real = custo_insumos ÷ produzida` (`null` se produzida = 0); `perda_pct = perdida ÷ (produzida + perdida)`;
- `produzida + perdida` precisa ser pelo menos 1; pode passar do planejado (sobra/produção extra é registrada, o limite é o estoque).

Concluída **não se cancela** (histórico nunca é apagado); correção é ajuste de estoque, com motivo. Concluir duas vezes ou duas conclusões simultâneas: só uma vale (`409` na outra).

## Permissões e isolamento
`empresa_id` sempre do JWT; ordem de outra empresa = 404. Custo (`custo_insumos`, `custo_unitario_real`, `custo_unitario` dos insumos) só para quem vê custos; para os demais os campos não existem.

## Fora desta entrega
Reserva de insumo ao iniciar, quantidades decimais e rendimento (módulo Fracionado), ordem de serviço, apontamento parcial em várias etapas e a tela (PR 3).
