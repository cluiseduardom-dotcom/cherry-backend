# Fiado — contrato da API (núcleo)

Base: migration `109_fiado.sql`. Funcionalidade `fiado` (módulo): **desligada para toda empresa**; a GiroNex liga avulsa por empresa (`docs/FUNCIONALIDADES.md`). Sem ela, todas as rotas respondem 403. O nome comercial do produto é decidido à parte; o código usa o termo do domínio, `fiado`.

## Modelo
- `fiado_lancamentos`: livro-razão **append-only** (o banco recusa UPDATE/DELETE). `tipo` = `compra` (soma) | `pagamento` (subtrai) | `estorno` (inverte o lançamento estornado, com motivo). Cada lançamento só é estornado uma vez.
- `fiado_saldos`: saldo por cliente, atualizado **na mesma transação**, com a linha travada. `CHECK (saldo >= 0)`.
- Valores `NUMERIC(12,2)`; data de calendário `DATE` devolvida como `YYYY-MM-DD`; `empresa_id` sempre do JWT; cliente e usuário da mesma empresa (FK composta).

## Regras
1. Pagamento maior que o saldo → 422. Estorno que deixaria o saldo negativo → 422 (estorne antes os pagamentos posteriores).
2. `Idempotency-Key` obrigatório (8 a 80 letras, números, `-`, `_`) nos três POSTs. Repetir com o mesmo conteúdo → 200 com `Idempotent-Replayed: true` e o lançamento original; outro conteúdo ou outro cliente → 409.
3. Data do lançamento opcional (`AAAA-MM-DD`, não futura); padrão = hoje em America/Sao_Paulo.
4. Cliente inativo ou anonimizado não recebe lançamento (409).
5. Papéis: **admin** e **vendedor** lançam e consultam; **só admin estorna**; estoquista não acessa. Quem não tem `ver_todos_clientes` só enxerga clientes que cadastrou (mesma regra de `/clientes`; fora do escopo = 404).
6. Nada de custo, margem ou taxa da plataforma existe nestas respostas.

## Rotas (`/fiado`, autenticadas, `Cache-Control: no-store`)
| Método | Rota | Corpo / consulta | Resposta |
|---|---|---|---|
| GET | `/fiado/resumo` | `?de=&ate=` (padrão: dia 1 do mês até hoje) | `total_a_receber`, `clientes_devedores`, `periodo { de, ate, compras, pagamentos }` (já descontados os estornos), `crediario_a_receber`, `ultimas_movimentacoes` |
| GET | `/fiado/clientes` | `?busca=&com_saldo=true&page=&pageSize=` | `itens [{ id, nome, telefone, saldo }]` por saldo desc., `total`, paginação |
| GET | `/fiado/clientes/:id/extrato` | `?page=&pageSize=` | `cliente`, `saldo`, `lancamentos` (novos primeiro, com `estornado`), `crediario { total, parcelas }` **só leitura** |
| POST | `/fiado/clientes/:id/compras` | `{ valor, descricao, data? }` | `201 { lancamento, saldo }` |
| POST | `/fiado/clientes/:id/pagamentos` | `{ valor, forma?, data? }` (`forma`: dinheiro, pix, debito, credito, outro) | `201 { lancamento, saldo }` |
| POST | `/fiado/lancamentos/:id/estorno` | `{ motivo }` (3 a 300) | `201 { lancamento, saldo }` (só admin) |
| GET | `/fiado/clientes/:id/cobranca` | — | `{ saldo, mensagem, link_whatsapp }`; 422 sem saldo ou sem telefone brasileiro válido |

Valor: número positivo, até 2 casas, máximo R$ 999.999,99. Corpo estrito (campo extra → 400).

## Cobrança por WhatsApp
O servidor só **monta** a mensagem e o link `https://wa.me/55<DDD><número>?text=<codificado>`; o comerciante revisa e envia. Não há envio automático nem API oficial do WhatsApp.

## Crediário do PDV
As parcelas pendentes do cliente em **Contas a receber** (venda a prazo do PDV) aparecem no extrato e no resumo, **separadas** do saldo do fiado e sem alterá-lo. Pagamento parcial de uma conta a receber do PDV **não faz parte** deste núcleo (melhoria separada).

## Fora do núcleo (próximas entregas)
Telas do ERP, layout enxuto, plano comercial do módulo, assinatura e cobrança recorrente, parcelas e juros de atraso.
