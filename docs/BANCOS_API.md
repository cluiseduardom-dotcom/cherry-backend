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

`GET /bancos/movimentos` devolve `conciliacao_id` (conciliação ativa) para a tela poder desfazer.

`GET /financeiro/fluxo-caixa` passa a ignorar movimentos cancelados e a agrupar por dia de Brasília.


## Mercado Pago como conta (sincronização)

`POST /bancos/mercadopago/sincronizar` `{ conta_bancaria_id }` (gerir_financeiro).

- A conta é uma "Conta de pagamento" criada normalmente (com o saldo inicial real e a data desse saldo). A primeira
  sincronização a liga ao provedor `mercadopago`. Exige o Mercado Pago conectado (409 claro se não estiver).
- **Puxada sob demanda**, fora do fluxo de venda/pagamento: falha aqui não toca em venda, cobrança nem estoque.
  Máximo 100 cobranças + 100 devoluções por chamada; `tem_mais: true` = chamar de novo.
- Entrada = `net_received_amount` do pagamento (já sem tarifa e sem a taxa da plataforma), na data
  `money_release_date` (futura = `a_liberar`). O detalhe (bruto, tarifa, taxa) vai na observação.
- Devolução concluída = saída pelo valor devolvido, na data da conclusão.
- Só entram cobranças/devoluções posteriores à data do saldo inicial da conta.
- Idempotente: referências `mp:pay:<id do pagamento>` e `mp:ref:<id da devolução>` (origem `API_BANCO`).
  Item com erro não derruba os demais: volta em `erros` e é tentado de novo na próxima chamada.
- Resposta: `{ entradas, saidas, ja_lancados, erros: [{referencia, erro}], tem_mais }`.
- **Limites conhecidos**: só vê pagamentos feitos pelo Vertumno (venda recebida fora dele, saques e tarifas
  avulsas do Mercado Pago não aparecem: exigem o relatório do Mercado Pago/extrato). Se a tarifa é devolvida
  numa devolução, o saldo fica um pouco abaixo do real (a confirmar no primeiro uso com dinheiro real).

## Importação de extrato (OFX/CSV)

Dois passos, ambos `gerir_financeiro`, corpo JSON `{ conta_bancaria_id, conteudo (texto do arquivo), formato? ('OFX'|'CSV') }`
(até ~3 MB de texto; o formato é detectado se omitido):

- `POST /bancos/importacoes/previa` — não grava nada. Devolve `{ formato, resumo, linhas, erros }`. Cada linha:
  `{ indice, data, tipo, valor, descricao, referencia_externa, situacao }` com `situacao` =
  `nova` | `ja_importada` | `possivel_duplicado` (+ `duplicado_de`) | `fora_do_saldo` | `futura`.
- `POST /bancos/importacoes` — grava as linhas `nova` (e os `possivel_duplicado` cujas referências vierem em
  `incluir_possiveis_duplicados`) **numa transação só**. Resposta `{ importadas, resumo }`.
- `GET /bancos/movimentos/:id/sugestoes` — até 5 contas a pagar (saída) ou a receber (entrada) **pendentes, de valor
  idêntico**, com vencimento até 15 dias do movimento. É só sugestão: marcar como paga/recebida segue nas telas atuais
  (que não geram movimento bancário, então não há lançamento em dobro).

Regras:
- Movimentos entram com origem `EXTRATO` (migration `087`), valor/tipo pelo sinal, data ao meio-dia de Brasília.
- **Deduplicação**: OFX usa o `FITID` do banco (`ofx:<FITID>`); CSV não tem id, então usa hash de data+valor+descrição+nº
  da ocorrência no arquivo. Reimportar o mesmo arquivo nunca duplica. Linha cancelada continua "já importada".
  Limite do CSV: um arquivo que cubra o mesmo período por outro recorte pode contar diferente uma linha idêntica repetida
  no mesmo dia.
- **Contagem em dobro**: linha com lançamento ativo não-extrato (manual, Mercado Pago) de mesmo tipo/valor em ±1 dia
  vira `possivel_duplicado` e não é importada por padrão.
- Linha anterior à data do saldo inicial da conta (`fora_do_saldo`) ou com data futura (`futura`) não é importada;
  linha ilegível vai em `erros` com o número da linha do arquivo, nunca é adivinhada. Máximo 5000 linhas.
- CSV: separador `;` ou `,`; colunas `Data`, `Valor` (ou `Crédito` e `Débito`) e `Descrição/Histórico`; datas
  `dd/mm/aaaa` ou `aaaa-mm-dd`; valores `1.234,56` ou `1234.56`.
- O arquivo deve chegar já em texto UTF-8 (a tela decodifica Windows-1252 quando preciso).
