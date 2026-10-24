# Estoque por local — contrato (fatia 1)

Base: migration `058_estoque_locais.sql`. Esta fatia não muda o comportamento visível: todo o saldo vai
para o local **Central**. Maleta, Consignado, transferência com aceite e venda por local vêm nas próximas fatias.

## Modelo
- `locais_estoque` (por empresa): `tipo` = `central` | `maleta` (dono = usuário) | `consignado` (opcional `cliente_id`) | `transito`.
  Um Central e um Em trânsito por empresa; uma Maleta por usuário.
- `estoque_locais`: saldo por (produto, local), **nunca negativo** (CHECK).
- `produtos.estoque_atual` continua sendo o **total**. Invariante: soma dos saldos por local = `estoque_atual`,
  mantida na mesma transação, pela única função de escrita (`estoqueRepository.criarMovimentacao`).
- `movimentacoes_estoque` ganha `local_id` e `saldo_local_resultante`. `estoque_resultante` segue sendo o total.
- Produto criado com `estoque_atual > 0` nasce com 0 e recebe uma entrada auditada "Estoque inicial" no Central.

## Regras de `criarMovimentacao`
- Sem `local_id` → Central (criado sob demanda para empresas novas).
- `entrada`/`saida` somam/subtraem do saldo **do local**; saída acima do saldo do local = `ESTOQUE_INSUFICIENTE` (409),
  mesmo que o total cubra.
- `ajuste` define o saldo **do local**; o total muda pela diferença.
- A trava do produto (`FOR UPDATE`) vem primeiro e serializa todas as movimentações do produto.
- `local_id` de outra empresa, inexistente ou inativo → 404.

## Rotas (admin e estoquista)
- `POST /produtos/:id/movimentacoes` — aceita `local_id` opcional (inteiro positivo).
- `GET /produtos/:id/estoque-locais` — `{ produto_id, estoque_total, consistente, locais: [{ local_id, tipo, nome, usuario_id, cliente_id, ativo, saldo }] }`.
  `consistente` confere a invariante.
- `GET /produtos/locais-estoque` — locais da empresa do token.
