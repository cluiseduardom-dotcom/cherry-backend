# Contas a receber — recebimento total e parcial

Base: migrations `009`, `021` (parcelas e recebimentos) e `110` (idempotência). Rotas `/contas-receber` (só admin).

## Modelo
- Venda no **crediário** gera uma **parcela** (`parcelas_pagamento`) e uma **conta a receber** (`contas_receber.parcela_id`) por vez.
- Cada recebimento (parcial ou total) é uma linha em `recebimentos_conta` (valor, forma, quem, quando, observação, `chave_idempotencia`). `parcelas_pagamento.valor_pago` é a soma deles.
- A conta fica **`pendente`** até o restante zerar; então vira **`recebido`**. A parcela passa por `pendente` → `parcial` → `recebida`. O pagamento da venda acompanha (`pendente`/`parcial`/`pago`), e a **comissão libera na proporção do que já foi pago**.
- Conta **legada** (venda a prazo anterior às parcelas, sem `parcela_id`): só pode ser recebida **por inteiro**.

## Crediário: teto de 6 meses (decisão do PO, 15/11/2026)
A parcela N vence em **N × `meses_prazo`** meses a partir da venda. O **último vencimento** (parcelas × `meses_prazo`) fica a no máximo **6 meses**: `6x de 1 mês`, `3x de 2`, `2x de 3` e `1x em 6` cabem; `12x de 1 mês` e `4x de 2` não (400, e a tela já barra antes). `meses_prazo` vai de 1 a 6 (venda a prazo legada também). Não vale para cartão de crédito (até 24x).

## Rotas
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/contas-receber`, `/contas-receber/:id` | filtros `status`, `vencimento_de`, `vencimento_ate` | conta com `valor_recebido`, `valor_restante` e `parcial` |
| POST | `/contas-receber/:id/recebimentos` | `{ valor?, forma_pagamento?, observacao? }` + **`Idempotency-Key`** | `201 { conta, recebimento }` |
| GET | `/contas-receber/:id/recebimentos` | — | histórico (valor, forma, data, observação, quem recebeu) |
| PATCH | `/contas-receber/:id/receber` | — | recebe o **restante** (compatibilidade) |

- **Sem `valor`** = recebe o restante, **calculado pelo servidor sob trava** (a tela não decide).
- `valor`: número positivo, até 2 casas; **não pode passar do restante** (409). `forma_pagamento`: dinheiro (padrão), pix, débito, crédito.
- **Idempotência:** `Idempotency-Key` obrigatório (8–80 caracteres). Mesma chave e mesmo conteúdo → `200` com `Idempotent-Replayed: true` e o recebimento original, **sem lançar o dinheiro de novo**; outro conteúdo → 409.
- Corpo estrito: empresa, conta, parcela e status nunca vêm do cliente.

## Correção incluída
O `PATCH /contas-receber/:id/receber` de conta **com parcela** só virava a conta para "recebido", deixando a parcela e o pagamento pendentes, sem recebimento registrado e **sem liberar a comissão**. Agora ele registra o recebimento da parcela (restante, em dinheiro), e tudo acompanha na mesma transação. (Antes da correção não havia contas a receber em produção.)

## Cancelamento
Venda com **recebimento parcial não pode ser cancelada** (409): o dinheiro já entrou em parte, e cancelar esconderia o recebimento.

## Colheita (fiado)
O extrato do cliente e o resumo somam o **restante** do crediário (`valor_restante`), não o valor cheio.

## Fora desta entrega
Conciliação bancária ainda sugere título pelo valor cheio da conta (um depósito igual ao recebimento parcial não é sugerido).
