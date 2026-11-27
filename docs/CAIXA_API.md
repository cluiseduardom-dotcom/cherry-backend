# Caixa por PDV — API (Tarefa 03, PR B e C)

Opcional por empresa: exige a funcionalidade `caixa` (nenhum plano a inclui; a GiroNex liga avulso). Sem ela, tudo abaixo responde 403 e o ERP segue como antes.
Com a funcionalidade ligada, a venda do PDV (`POST /vendas`) só nasce com o caixa do vendedor **aberto** (409 "Abra o caixa para vender") e exige `pagamentos[]` (400 no formato legado, que não diz a forma). Sem a funcionalidade, nada muda. A venda da loja online não passa por caixa.

## Capacidades (por cargo, editáveis na tela de cargos)
| Capacidade | O que permite | Padrão |
|---|---|---|
| `operar_caixa` | abrir caixa; movimentar e fechar a **própria** sessão | Vendedor, Operador, Analista, Supervisor, Coordenador, Gerente, Diretor, Admin |
| `gerir_caixas` | cadastrar/desativar caixas; ver, movimentar e fechar a sessão de **qualquer** operador | Supervisor, Coordenador, Gerente, Diretor, Admin |

Empresas que já editaram um cargo (linha em `cargos_empresa`) não recebem o padrão novo sozinhas: o admin concede na tela de cargos. Sem a capacidade, 403.
Sessão de outro operador, para quem não tem `gerir_caixas`, responde **404** (como se não existisse).

## Rotas (`/caixa`)
| Método e rota | Quem | Efeito |
|---|---|---|
| `GET /caixa/caixas` | operar ou gerir | caixas ativos e, em cada um, quem o está usando (gerir vê também os desativados) |
| `POST /caixa/caixas` `{nome}` | gerir | cria; nome único por empresa, sem diferenciar maiúscula (409) |
| `PATCH /caixa/caixas/:id` `{ativo}` | gerir | ativa/desativa; recusa desativar com sessão aberta (409). Nunca apaga |
| `GET /caixa/sessao-atual` | operar ou gerir | a sessão aberta do próprio usuário com resumo/esperado, ou `atual: null` |
| `POST /caixa/sessoes` `{caixa_id, saldo_inicial}` | operar | abre. 409 se o caixa já está aberto ou se o operador já tem outro aberto. Repetir a mesma abertura (retry) devolve a sessão com 200 e `Idempotent-Replayed: true` |
| `GET /caixa/sessoes?status&caixa_id&page&pageSize` | operar (só as suas) / gerir (todas) | lista paginada |
| `GET /caixa/sessoes/:id` | dono ou gerir | sessão, movimentos, resumo, `esperado` e conferência (se fechada) |
| `POST /caixa/sessoes/:id/movimentos` `{tipo: suprimento\|sangria, valor, motivo}` | dono ou gerir | **exige `Idempotency-Key`**. Mesma chave + mesmo conteúdo = o movimento original (200); outro conteúdo = 409. Sangria maior que o dinheiro em caixa = 422 |
| `POST /caixa/sessoes/:id/fechamento` `{conferencia:[{forma, informado}], justificativa?}` | dono ou gerir | o servidor calcula o esperado de cada forma; o cliente só informa o contado, e precisa conferir o dinheiro e toda forma com venda/estorno na sessão (400 se faltar). Com diferença, a justificativa é obrigatória (400 sem ela); fecha mesmo assim e devolve `divergente: true` + `aviso`. Sem aprovação de gerente (decisão do PO) |

## Garantias
- `empresa_id` e usuário vêm só do JWT; corpo com campos extras é recusado (400).
- Transação com a linha da sessão (ou do caixa) travada: sangria × fechamento × outra sangria não deixam movimento fora da conferência nem o caixa negativo.
- O banco impõe: uma sessão aberta por caixa e por operador; movimento só em sessão aberta; movimentos e conferências insere-só; sessão fechada imutável; chave de idempotência única por empresa (migrations 133 e 134).
- Trilha: quem abriu (`operador_id`), quem movimentou (`usuario_id`), quem fechou (`fechada_por`) e quando, tudo imutável.

## Como o esperado é calculado (PR C)
Por forma (`dinheiro`, `pix`, `debito`, `credito`, `crediario`): **pagamentos de venda da sessão − estornos atribuídos à sessão**. No dinheiro, soma ainda troco inicial + suprimentos − sangrias. O troco devolvido ao cliente não conta (vale o `valor` do pagamento, não o `valor_recebido`).
`GET /caixa/sessoes/:id` devolve `esperado` e `por_forma` (`vendas`, `estornos`, `esperado`).

De qual sessão sai um estorno (cancelamento da venda ou `POST /pagamentos/:id/estornar`): a do pagamento original, se ainda aberta; senão a sessão aberta de quem estorna; senão nenhuma (fica sem sessão, visível no banco). Sessão fechada nunca muda.

## Limites conhecidos
- Recebimento de parcela de crediário/conta a receber e pagamento de fiado **em dinheiro no balcão** não entram no esperado; devem ser lançados como suprimento (com motivo) para o dinheiro fechar.
- Com a funcionalidade ligada, quem vende precisa de `operar_caixa` para abrir o caixa (sem ela, não consegue vender pelo PDV).
- Estorno de pagamento sem sessão aberta (nem a original, nem a de quem estorna) não entra em nenhum fechamento.

## Pendente
Tela do PDV no frontend (abrir/fechar caixa, sangria/suprimento, conferência) e a tela de cargos listar `operar_caixa` e `gerir_caixas`.
