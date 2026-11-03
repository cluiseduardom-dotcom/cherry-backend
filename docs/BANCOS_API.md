# Bancos (contas, movimentos, saldo e conciliação)

Mount: `/bancos` · `authMiddleware` + `requireCapacidade(gerir_financeiro)` (Admin tem todas). `empresa_id` e o
usuário vêm sempre do JWT. Migration `086`.

## Regras
- **Saldo** = `saldo_inicial` + movimentos **ativos** (não cancelados) com data ≤ agora e a partir de
  `data_saldo_inicial`. Movimento com data futura (liberação de cartão) aparece em `a_liberar`, não no saldo.
- **Movimento não se apaga nem se altera.** Erro se corrige com `POST /movimentos/:id/cancelar` (motivo
  obrigatório); o banco recusa `DELETE` e a mudança de valor, tipo, data, conta e referência (trigger).
  Movimento conciliado precisa ter a conciliação desfeita antes de cancelar.
- **Lançamento manual** (`POST /movimentos`): origem sempre `MANUAL`, só data de hoje ou passada, descrição
  obrigatória, valor > 0 com no máximo 2 casas. Contas criadas pela API são sempre `MANUAL`; contas integradas
  (Mercado Pago, Open Finance) só o sistema cria.
- **Idempotência**: índice único `(empresa_id, conta, origem, referencia_externa)`. Lançamento automático ou
  importado usa `criarSeNovo` e nunca duplica (nem ressuscita um movimento cancelado).
- **Saldo inicial** não muda depois que a conta tem movimentos (use um ajuste) e não é editável em conta integrada.
- **Conciliação** é atômica: marca o movimento e cria a conciliação na mesma instrução; duas chamadas simultâneas,
  só uma vence. Desfazer devolve o movimento para "não conciliado" e permite conciliar de novo.

## Endpoints
| Método | Caminho | Corpo / query |
|---|---|---|
| GET | `/bancos/contas` | `status?`, `tipo?` → contas com `saldo_atual`, `a_liberar`, `movimentos` |
| POST | `/bancos/contas` | `nome, tipo, saldo_inicial?, data_saldo_inicial?, banco_codigo?, instituicao_nome?, agencia?, conta?, digito?, observacao?, principal?` |
| GET | `/bancos/contas/:id` | conta com saldo |
| PATCH | `/bancos/contas/:id` | qualquer campo acima (parcial) |
| PATCH | `/bancos/contas/:id/status` | `status`: `ATIVA` \| `BLOQUEADA` \| `INATIVA` |
| GET | `/bancos/movimentos` | `conta_bancaria_id?, tipo?, conciliado?, data_inicio?, data_fim?, incluir_cancelados?, limit?, offset?` → `{ items, total }` |
| POST | `/bancos/movimentos` | `conta_bancaria_id, tipo, valor, data_movimento (YYYY-MM-DD), descricao, observacao?` |
| POST | `/bancos/movimentos/:id/cancelar` | `motivo` |
| GET | `/bancos/conciliacoes` | — |
| POST | `/bancos/conciliacoes` | `movimento_bancario_id, referencia_externa?, valor_externo?, data_externa?, descricao_externa?, observacao?` |
| POST | `/bancos/conciliacoes/:id/desfazer` | — |

Campos desconhecidos são recusados (400). Ids e valores `NUMERIC` voltam como string (padrão do `pg`).

`GET /financeiro/fluxo-caixa` passa a ignorar movimentos cancelados e a agrupar por dia de Brasília.
