# Cotações (compras avançado)

Parte da funcionalidade `compras_avancado` (migration 127; sem migration nova). Pedir preço a vários fornecedores, registrar as propostas,
comparar item a item e gerar o(s) pedido(s) de compra do vencedor de cada item. As tabelas (`cotacoes*`) já existiam desde a migration 027.

Fluxo: **cotação → pedido de compra (rascunho) → enviar → receber/aprovar → estoque e conta a pagar** (o resto é o fluxo de `COMPRAS_AVANCADO.md`).

## Rotas (admin e estoquista; vendedor 403; sem a funcionalidade 403)
| Método | Rota | O que faz |
|---|---|---|
| POST | `/cotacoes` | Cria já ABERTA, com itens e fornecedores (`COT-AAAA-NNNN`, sob trava por empresa) |
| GET | `/cotacoes` | Lista paginada (`status`) com contagem de itens, fornecedores e respondidas |
| GET | `/cotacoes/:id` | Detalhe: itens (com `melhor_fornecedor_id`), fornecedores e todas as ofertas com total |
| PUT | `/cotacoes/:id/fornecedores/:fornecedorId/oferta` | Registra a proposta do fornecedor (troca a anterior); marca RESPONDIDA |
| POST | `/cotacoes/:id/fornecedores/:fornecedorId/recusar` | Fornecedor recusou: apaga a proposta, marca RECUSADA |
| POST | `/cotacoes/:id/gerar-pedidos` | `{ escolhas: [{ cotacao_item_id, fornecedor_id }] }` → um pedido (rascunho) por fornecedor; encerra a cotação |
| POST | `/cotacoes/:id/cancelar` | ABERTA → CANCELADA |

## Regras
- `empresa_id` do JWT; fornecedores e produtos validados no tenant (404), inativos = 400. Quantidade inteira (unidade-base).
- Sem rascunho: a cotação nasce ABERTA. Estados usados: ABERTA, ENCERRADA, CANCELADA (EM_ANALISE existe no banco, não é usado).
- Proposta: preço unitário (6 casas), desconto, quantidade ofertada (padrão = solicitada, nunca maior), prazo de entrega e condição de pagamento.
  O fornecedor pode cotar só parte dos itens.
- **Melhor oferta** = menor preço efetivo por unidade `(qtd × preço − desconto) ÷ qtd`; empate fica com a registrada primeiro. É só **sugestão**:
  quem escolhe o fornecedor de cada item é a pessoa, em `gerar-pedidos`. Só dá para escolher fornecedor que cotou o item.
- Cada pedido gerado leva os itens e preços da proposta, `cotacao_id`, a condição de pagamento da proposta, entrega prevista = hoje + maior prazo
  e a observação "Gerado da cotação X". Itens sem escolha não são pedidos.
- Geração atômica sob lock da cotação: duas chamadas ao mesmo tempo, só uma gera (a outra recebe 409). Cotação encerrada/cancelada não recebe
  proposta, não gera de novo e não cancela.

## Fora do escopo
Ordem de compra interna (requisição com aprovação), envio automático de e-mail ao fornecedor, frete por proposta (o pedido aceita frete na edição).
