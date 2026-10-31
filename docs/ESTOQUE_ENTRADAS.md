# Entrada e ajuste de estoque

Regra do PO (31/10/2026): estoque só aumenta por um fato lógico e rastreável. Não existe "entrada livre".

## Como o estoque aumenta

| Caminho | Quem pode | Observação |
|---|---|---|
| **Compra** (`POST /compras`) | admin, estoquista | Vários itens, uma transação, grava `compra_id` e `origem = compra`, gera contas a pagar. |
| **Recebimento aprovado** (`POST /recebimentos/:id/aprovar`) | admin, estoquista | `origem = recebimento`. |
| **Estoque inicial** (`POST /produtos/:id/movimentacoes`, `tipo = entrada`, `motivo_codigo = estoque_inicial`) | **só admin** (não delegável) | Só em produto **sem nenhuma movimentação**; vale uma vez (cadastrar o produto já com `estoque_atual` também conta). A checagem roda na transação, com o produto travado: lançamentos simultâneos, só um vale. |
| **Recebimento sem compra** (`motivo_codigo = recebimento_sem_compra`) | admin ou cargo com a capacidade `receber_sem_compra` | Bonificação, devolução de cliente etc. Observação obrigatória (mín. 3 caracteres). |
| **Ajuste para mais** (`tipo = ajuste`, saldo do local maior que o atual) | admin ou cargo com a capacidade `ajustar_estoque` | A comparação é feita na transação, sem corrida. |

`tipo = entrada` com qualquer outro motivo (ex.: "reposição") é recusado com 400.

## Movimentação avulsa: contrato

`POST /produtos/:id/movimentacoes` (admin ou estoquista):

```json
{ "tipo": "saida", "quantidade": 2, "motivo_codigo": "avaria", "observacao": "Caiu no chão", "local_id": 1 }
```

* `motivo_codigo` é obrigatório e de lista fechada por tipo (`src/constants/motivosEstoque.js`):
  * entrada: `estoque_inicial`, `recebimento_sem_compra`
  * saída: `perda`, `avaria`, `brinde`, `uso_interno`, `outro`
  * ajuste: `contagem`, `correcao`
* `observacao` (até 200 caracteres) é obrigatória em `recebimento_sem_compra`, `outro` e `correcao`.
* O campo antigo `motivo` (texto livre) **deixou de existir** no contrato. O texto gravado em `movimentacoes_estoque.motivo` é o rótulo + a observação.
* Erros: 400 (corpo/motivo inválido), 403 (sem permissão), 409 (estoque insuficiente; estoque inicial em produto com histórico).

Saída e ajuste **para menos** continuam com o estoquista (sempre com motivo da lista).

## Capacidades

`ajustar_estoque` e `receber_sem_compra` foram adicionadas ao catálogo (`src/constants/cargos.js`). Nenhum cargo as tem por padrão; o Admin as tem sempre. O Admin da empresa as concede a um cargo pela API de cargos (`cargos_empresa.capacidades`).

Limite conhecido: `/compras`, `/recebimentos` e a movimentação avulsa exigem perfil `admin` ou `estoquista`. O "cargo responsável por compras" é, portanto, o **Estoquista** com a capacidade concedida; um cargo de perfil vendedor não alcança essas rotas.

## Origem (migration 080)

`movimentacoes_estoque.origem` (VARCHAR(40), anulável) guarda o código do caminho acima, mais `cancelamento_compra`. A migration classifica só o que tem marca inequívoca nas linhas antigas (`compra_id`, motivo `Recebimento #n`, `Estoque inicial`, `cancelamento_compra`); o resto fica `NULL`, sem adivinhar. Venda, produção, transferência e consumo ainda não gravam origem (continuam `NULL`).

## Fora do escopo desta regra

* Compra e Recebimento seguem sem aprovação de segundo usuário: quem as registra altera estoque, mas deixa documento, fornecedor e contas a pagar.
* Inventário/contagem com sessão e aprovação (diferença vira ajuste) não existe ainda.
