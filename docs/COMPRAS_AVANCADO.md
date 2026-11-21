# Compras avançado: pedido de compra → recebimento → estoque e conta a pagar

Funcionalidade `compras_avancado` (migration 127). Ligável pela GiroNex, por empresa; nenhum plano a inclui.
As compras diretas (`/compras`) e as rotas de `/recebimentos` seguem abertas como sempre foram.

## O que já existia e o que entra
- Já existia: tabelas `pedidos_compra`/`pedidos_compra_itens`, recebimento com conferência, aprovação do recebimento
  (entrada de estoque, saldo do item, status do pedido, conta a pagar, evento de negócio).
- Faltava a porta de entrada: não havia rota para criar o pedido, e o recebimento exige um. Entram as rotas `/pedidos-compra`.

## Rotas (admin e estoquista; vendedor 403; sem a funcionalidade 403)
| Método | Rota | O que faz |
|---|---|---|
| POST | `/pedidos-compra` | Cria o pedido em RASCUNHO com os itens, numa transação |
| GET | `/pedidos-compra` | Lista paginada (`status`, `fornecedor_id`, `page`, `pageSize`) com fornecedor e nº de itens |
| GET | `/pedidos-compra/:id` | Detalhe com itens, `saldo` (pedido − recebido) e `produto_nome` |
| PUT | `/pedidos-compra/:id` | Troca cabeçalho e itens; só em RASCUNHO |
| POST | `/pedidos-compra/:id/enviar` | RASCUNHO (ou APROVADO) → ENVIADO |
| POST | `/pedidos-compra/:id/confirmar` | ENVIADO → CONFIRMADO |
| POST | `/pedidos-compra/:id/cancelar` | RASCUNHO/ENVIADO/CONFIRMADO → CANCELADO |

O recebimento é feito pelas rotas existentes de `/recebimentos`, apontando `pedido_compra_id`.

## Regras
- `empresa_id` vem do JWT; fornecedor e produtos precisam ser da empresa (404 se não), produto inativo = 400.
- Número `PC-AAAA-NNNN` gerado sob trava por empresa (criações simultâneas não repetem); aceita número informado, único na empresa (409).
- Total = Σ(qtd × preço − desconto do item) − desconto + frete + outras despesas (nunca negativo). Desconto do item maior que o valor do item = 400.
- Quantidade inteira (unidade-base). O corpo não aceita `empresa_id`, `status` nem `total` (400).
- Vencimento da conta a pagar = data do recebimento + `prazo_pagamento_dias` do pedido.
- Pedido recebido (parcial ou total) não se cancela; cancelado não volta.

## Correção incluída
`integracaoRecebimentoService.aprovar` marcava o recebimento como APROVADO só depois de recalcular o saldo do pedido, que soma
apenas recebimentos aprovados. Resultado: `quantidade_recebida` e o status do pedido nunca avançavam. Agora aprova antes de recalcular (mesma transação).

## Fora do escopo
Cotações, ordens de compra, aprovação interna de pedido e nota de entrada fiscal.
