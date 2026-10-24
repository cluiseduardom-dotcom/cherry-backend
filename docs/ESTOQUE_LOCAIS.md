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

# Fatia 2 — transferências com aceite (migration `059`)

## Fluxo
1. **Criar**: a mercadoria sai da origem e vai para **Em trânsito** (o total do produto não muda). Status `pendente`.
2. **Aceitar**: sai do trânsito e entra no destino → `concluida`.
3. **Recusar** (quem recebe) ou **cancelar** (quem criou, ou admin): volta do trânsito para a origem → `recusada`/`cancelada`. Motivo obrigatório (3–300 caracteres).
Toda transferência exige aceite. Existe um único Central por empresa, por isso não há transferência "automática" entre centrais.
Cada perna é uma movimentação comum (`movimentacoes_estoque.transferencia_id` a liga à transferência). Tudo numa transação; estoque insuficiente na origem = 409 e nada é gravado.

## Quem pode
| Ação | Regra |
|---|---|
| Criar | equipe (admin/estoquista): qualquer rota. Demais: só devolver da **própria** maleta ao Central |
| Aceitar/recusar | destino **maleta**: só o dono da maleta (nem admin). Destino **Central/consignado**: equipe |
| Cancelar | quem criou ou admin |
| Ver | equipe vê todas; demais só as em que criaram ou são dono de uma ponta (as outras respondem 404) |
| Criar local | só admin |
Nunca aparece custo. `empresa_id` e usuário vêm sempre do JWT.

## Rotas (`/estoque`)
- `POST /estoque/locais` — `{ tipo: "maleta", usuario_id, nome? }` ou `{ tipo: "consignado", nome, cliente_id? }` (admin). 409 se o usuário já tem maleta.
- `POST /estoque/transferencias` — `{ origem_local_id, destino_local_id, itens: [{ produto_id, quantidade }], observacao? }` (até 200 itens, sem produto repetido, sem Em trânsito como ponta).
- `GET /estoque/transferencias?status=&page=&pageSize=` · `GET /estoque/transferencias/:id` (com `itens` e `eventos`).
- `POST /estoque/transferencias/:id/aceitar` (sem corpo) · `/recusar` e `/cancelar` (`{ motivo }`).
Status inválidos de transição (já resolvida) = 409. Aceites/cancelamentos simultâneos são serializados por trava na linha da transferência.

## Trilha
`transferencias_eventos` (criar/aceitar/recusar/cancelar, quem, motivo, quando) é insert-only (o banco recusa UPDATE/DELETE).

# Fatia 3 — venda e cancelamento por local (migration `060`)

## Venda (`POST /vendas`)
Cada item aceita `local_id` opcional (ex.: `{ produto_id, quantidade, local_id }`).
- **Sem `local_id`**: sai da Maleta **ativa** do próprio vendedor (usuário do JWT), se existir; senão do Central (comportamento anterior).
- **Com `local_id`**: só o **Central** ou a **própria** Maleta. Consignado, Maleta de outra pessoa, Em trânsito ou Maleta inativa = **403**. Local inexistente ou de outra empresa = **404**.
- **Saldo insuficiente no local** = **409** (`Estoque insuficiente em "<local>" ...`); não há queda automática para o Central, o vendedor escolhe outro local. Nada é gravado (transação única). No Central a mensagem segue `Estoque insuficiente para essa venda`.
- Itens de uma mesma venda podem sair de locais diferentes. A resposta traz `local_id` em cada item. Preço e custo continuam sendo apurados no servidor; o vendedor nunca recebe custo.

## Cancelamento (`PATCH /vendas/:id/cancelar`)
Cada item volta ao local de onde saiu (`itens_venda.local_id`), mesmo que o estoque tenha se movido depois. Vale a regra de sempre: só vendas `finalizada` cancelam (a 2ª tentativa dá 409).

## Banco
- `itens_venda.local_id NOT NULL` + FK composta `(local_id, empresa_id)` → `locais_estoque`.
- Backfill: itens existentes → Central da empresa.
- Gatilho `BEFORE INSERT`: se `local_id` vier nulo, usa o Central (criando se faltar). Mantém compatível o código antigo durante o deploy, fixtures e importações; o código novo sempre informa o local.
- Reversão manual no rodapé da migration (não executada pelo runner).
