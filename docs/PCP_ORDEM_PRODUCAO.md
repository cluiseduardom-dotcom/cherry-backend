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
| `PATCH /producoes/ordens/:id/regularizar-insumos` | ordem `concluida` com pendência: baixa de cada insumo o que o Central tem (até o pendente). Sem pendência = 409; nenhum insumo com saldo = 409 |
| `PATCH /producoes/ordens/:id/cancelar` `{ motivo }` | `planejada` ou `em_producao`; motivo de 3 a 200 caracteres |

## Conclusão (a regra que mexe em estoque)
Numa transação, com a ordem e os insumos travados (insumos em ordem de id):
- cada insumo é baixado em `min((produzida + perdida) × consumo por unidade, saldo do Central)`: a perda também gasta insumo;
- o acabado entra **por inteiro** com `quantidade_produzida`;
- **faltar insumo NÃO bloqueia a produção** (regra do PO, 21/11/2026): o insumo pode existir fisicamente e só não ter dado entrada no sistema. O que faltou vira **pendência** (`ordem_producao_consumos`: `quantidade_prevista`, `quantidade_baixada`) e é baixado depois, em `regularizar-insumos`. O estoque nunca fica negativo. Mesmo desenho do consumo de insumos na venda (`docs/CONSUMO_INSUMOS_VENDA.md`);
- insumo inativo = `400` e nada é gravado;
- `custo_insumos` congela o custo da **necessidade completa** (inclui o que ainda não foi baixado); `custo_unitario_real = custo_insumos ÷ produzida` (`null` se produzida = 0); `perda_pct = perdida ÷ (produzida + perdida)`;
- `produzida + perdida` precisa ser pelo menos 1; pode passar do planejado.

A resposta traz `tem_pendencia` e `pendencias[]` (`quantidade_prevista`, `quantidade_baixada`, `quantidade_pendente`; `custo_unitario` só com permissão de custo). Quitada, some da lista. A listagem traz `insumos_pendentes`.
`GET /producoes/necessidade` continua **informativa**: `pode_produzir_tudo = false` é um aviso, não um impedimento.

Concluída **não se cancela** (histórico nunca é apagado); correção é ajuste de estoque, com motivo. Concluir duas vezes ou regularizar duas vezes ao mesmo tempo: só uma vale (`409` na outra).

## Permissões e isolamento
`empresa_id` sempre do JWT; ordem de outra empresa = 404. Custo (`custo_insumos`, `custo_unitario_real`, `custo_unitario` dos insumos) só para quem vê custos; para os demais os campos não existem.

## Fora desta entrega
Aviso no sino para pendência de insumo da ordem (existe só para vendas), reserva de insumo ao iniciar, quantidades decimais e rendimento (módulo Fracionado), ordem de serviço, apontamento parcial em várias etapas e a tela (PR 3).
