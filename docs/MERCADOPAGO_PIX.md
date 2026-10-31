# Mercado Pago — conexão da loja e Pix com comissão

Integração em modelo **marketplace**: cada loja autoriza a própria conta Mercado Pago (OAuth) e a Vertumno recebe uma comissão (`application_fee`, valor em reais) por Pix gerado. Usa a **Payments API** (`POST /v1/payments`); a Orders API não tem, na documentação consultada, campo equivalente à comissão. A Payments API não tem data de descontinuação publicada. Toda chamada ao provedor passa por `src/integrations/mercadoPagoClient.js`, para uma troca futura ficar isolada.

Sem as variáveis `MP_*` a integração fica **desligada**: nada muda para as lojas.

## Variáveis de ambiente
| Variável | O que é | Segredo? |
|---|---|---|
| `MP_APP_ID` | Número da aplicação no painel de desenvolvedores | não |
| `MP_CLIENT_SECRET` | Segredo da aplicação | **sim** |
| `MP_REDIRECT_URI` | `https://<api>/integracoes/mercadopago/callback`, igual ao cadastrado na aplicação | não |
| `MP_WEBHOOK_SECRET` | "Assinatura secreta" em Webhooks do painel | **sim** |
| `MP_WEBHOOK_URL` | `https://<api>/webhooks/mercadopago` | não |
| `MP_TOKEN_ENC_KEY` | 32 bytes em base64; cifra os tokens das lojas (AES-256-GCM) | **sim** |
| `MP_FRONTEND_URL` | Origem do frontend para onde o retorno do OAuth redireciona | não |
| `MP_EMAIL_PAGADOR_PADRAO` | Opcional. E-mail neutro da plataforma enviado como `payer.email` do Pix. Inválido ou ausente = ignorado | não |
| `MP_SANDBOX` | `true` envia `test_token` no OAuth | não |
| `MP_API_URL` / `MP_AUTH_URL` | Opcionais (padrão `api.mercadopago.com` / `auth.mercadopago.com`) | não |

**E-mail do pagador (`payer.email`)** — o Mercado Pago exige um e-mail na cobrança. Ordem: `cliente_email` informado > `MP_EMAIL_PAGADOR_PADRAO` > e-mail de contato da empresa (comportamento antigo, mantido como último recurso). Recomendado definir `MP_EMAIL_PAGADOR_PADRAO` com um e-mail da plataforma que **não** seja o de nenhuma conta Mercado Pago de loja: o do contato da empresa pode coincidir com o da conta que recebe (hipótese de recusa; não confirmada). O PDV hoje não envia `cliente_email`, então nenhum dado do cliente vai ao Mercado Pago.

Perder `MP_TOKEN_ENC_KEY` invalida os tokens guardados (as lojas precisam reconectar). Trocá-la tem o mesmo efeito.

## Endpoints
| Rota | Quem | O que faz |
|---|---|---|
| `GET /integracoes/mercadopago` | admin | `{configurado, conectado, conectado_em}` (nunca tokens) |
| `POST /integracoes/mercadopago/conectar` | admin | devolve `{url}` de autorização; grava `state` de uso único (10 min) |
| `GET /integracoes/mercadopago/callback` | público (por `state`) | troca o código, guarda tokens cifrados, redireciona a `MP_FRONTEND_URL/configuracoes/empresa?mercadopago=conectado\|erro` |
| `DELETE /integracoes/mercadopago` | admin | desconecta e apaga os tokens |
| `GET /pagamentos-gateway/disponibilidade` | admin, vendedor | `{ pix, motivo }`: `pix=true` se a integração está configurada e a loja conectada; senão `motivo` = `nao_configurado` ou `loja_nao_conectada`. Não consulta o provedor (um token recusado ainda vira 409 ao cobrar) |
| `POST /pagamentos-gateway/pix` `{valor, cliente_email?}` | admin, vendedor | cria cobrança Pix (QR válido por 30 min) |
| `GET /pagamentos-gateway/:codigo` | admin, vendedor | estado da cobrança (reconsulta o provedor, no máximo a cada 5 s) |
| `POST /webhooks/mercadopago` | público (assinatura) | reconsulta o pagamento e aplica a transição |

Erro do provedor responde **424** (o `errorHandler` esconde a mensagem de 5xx; o caixa precisa lê-la). Integração desligada responde 409 nas rotas da loja.

## Regras
- **Comissão:** mesma regra da taxa de venda (condição individual > plano > padrão), aplicada sobre o valor do Pix e enviada como `application_fee`. Arredondando para 0, o campo não é enviado. A taxa **nunca** aparece na resposta ao PDV.
- **Webhook:** valida `x-signature` e **não confia no corpo**: reconsulta `GET /v1/payments/{id}` com o token da loja dona da cobrança e confere id, `external_reference` (nosso `codigo`) e valor. Transições: `pendente → pago|cancelado|estornado`, `pago → estornado`; nada volta a pendente.
- **Tokens:** cifrados no banco, nunca devolvidos nem logados; renovados sob lock quando faltam menos de 7 dias.
- **Isolamento:** toda leitura de cobrança filtra por `empresa_id`; o id do provedor só serve para o webhook localizar a cobrança.

## Ainda NÃO confirmado (validar no sandbox antes de produção)
1. Manifesto da assinatura do webhook (`id:…;request-id:…;ts:…;` com HMAC-SHA256 hex): a documentação consultada não o descreve. Está isolado em `src/utils/mercadoPagoAssinatura.js`.
2. `grant_type` do código de autorização (usamos `authorization_code`) e `refresh_token` na renovação (a página mostra `refresh-token` num exemplo).
3. Nomes dos campos da resposta do OAuth (`access_token`, `refresh_token`, `expires_in`, `user_id`).
4. Se o `application_fee` é aceito em pagamentos **Pix** (a documentação só mostra exemplo com cartão) e se incide sobre o valor bruto ou depois da tarifa do Mercado Pago.
5. Formato de `date_of_expiration` com offset `-03:00`.
6. Cartão presencial (Point) e QR presencial **não** têm comissão documentada: fora desta integração.

## Limitações conhecidas
- Se o banco falhar depois de o Mercado Pago criar o Pix, a cobrança fica sem `id_externo` e o webhook não a encontra (o pagamento existiria sem registro). Risco baixo; a reconciliação fica para a PR que liga a cobrança à venda.
- A cobrança ainda **não é consumida por uma venda**: a validação (mesma empresa, paga, mesmo valor, uso único) e o abatimento da taxa já cobrada pelo gateway na tela de taxas a receber entram na PR seguinte.

## Pix cobrado na venda (cobrança → venda)

- `POST /vendas` aceita `cobranca_codigo` (UUID) em um pagamento `pix` de `pagamentos[]`. O backend, na transação da venda, trava a cobrança e confere: mesma empresa (do JWT), `status = 'pago'`, valor idêntico ao do pagamento e ainda não usada. Qualquer divergência desfaz a venda inteira.
- O pagamento nasce com `origem = 'gateway'`, `provedor = 'mercadopago'` e `transacao_externa_id` = id do pagamento no Mercado Pago. O cliente nunca declara origem/provedor (o schema é estrito); Pix sem `cobranca_codigo` segue manual.
- A cobrança recebe `venda_id`/`usada_em` e não entra em outra venda.
- **Cancelar a venda não estorna o Pix no Mercado Pago.** A devolução é um pedido explícito do financeiro (ver "Devolução de Pix" abaixo).

## Taxas a receber (`GET /plataforma/taxas`)

O ledger `taxas_venda` continua registrando a taxa de toda venda. A comissão que o Mercado Pago já reteve (`cobrancas_pagamento.taxa_plataforma` das cobranças pagas ligadas à venda apurada) é abatida para não cobrar duas vezes:

- `total_taxa`: taxa apurada no mês (todas as vendas);
- `total_cobrado_gateway`: parte já retida pelo Mercado Pago;
- `total_a_receber`: `max(0, total_taxa − total_cobrado_gateway)`, o que falta cobrar na fatura mensal.

Vendas canceladas (taxa estornada) ficam fora dos dois lados.

## Devolução de Pix (migration 076)

Devolve ao pagador um Pix **pago** que não está numa venda ativa: **sem venda** (o cliente pagou e a venda não foi concluída) ou de **venda cancelada**. Só quem tem `gerir_financeiro` (Admin, Diretor, Gerente, Analista financeiro por padrão). Pix de venda ativa não se devolve: cancele a venda antes.

| Rota | Quem | O que faz |
|---|---|---|
| `GET /pagamentos-gateway/a-devolver?limit=&offset=` | `gerir_financeiro` | `{ items: [{ codigo, valor, criado_em, venda_id, situacao: 'sem_venda' \| 'venda_cancelada' }], total, valor_total }`. Nunca traz taxa, id do provedor ou do banco |
| `POST /pagamentos-gateway/:codigo/devolucao` `{ motivo }` | `gerir_financeiro` | devolve o valor integral. `{ codigo, valor, status: 'concluida' \| 'solicitada' }` |
| `GET /pagamentos-gateway/devolucoes?limit=&offset=` | `gerir_financeiro` | histórico: valor, status, motivo, quem pediu, quando |

Fluxo (`cobrancasPagamentoService.devolver`):
1. Reconsulta o provedor (se já foi devolvido pelo painel do Mercado Pago, só reflete: 409 "já foi devolvido").
2. Reserva o pedido em `cobranca_devolucoes` **sob a trava da cobrança**, conferindo: Pix pago, sem devolução ativa, e sem venda ou com venda cancelada. Índice único parcial: uma devolução ativa por cobrança.
3. Chama `POST /v1/payments/{id}/refunds` (corpo vazio = total) com o token da loja e `X-Idempotency-Key: devolucao-<id>`.
4. `approved` → `concluida` e a cobrança vira `estornado`. Outro status (em processamento) → fica `solicitada` e a consulta/webhook seguinte conclui. Recusa/erro → `falhou` (mensagem curta, sem detalhe do provedor) e dá para pedir de novo (nova chave de idempotência).
- Um Pix com devolução ativa **não entra em venda** (`consumirParaVenda` confere sob a mesma trava).
- `empresa_id` sempre do JWT; toda query filtra por empresa.

**NÃO validado contra o Mercado Pago real** (o sandbox não aprova Pix; os testes simulam o provedor). Confirmar no primeiro uso com dinheiro real, com valor pequeno:
1. O endpoint e o corpo vazio como devolução total, e o `status` `approved` na resposta.
2. O prazo máximo para devolver Pix.
3. Se a conta da loja precisa ter saldo no momento da devolução.
4. Se a comissão da Vertumno (`application_fee`) é devolvida junto e em que proporção (a documentação consultada não diz; se não for, a taxa retida precisa ser tratada à parte).
5. Que o webhook `payment.updated` chega com `refunded` (a cobrança passa a `estornado` por ele quando a resposta da devolução se perder).
Cancelar a venda **não** devolve o Pix sozinho: a devolução é um pedido explícito do financeiro.

**Observado no primeiro teste com dinheiro real (Pix de R$ 20,00, loja conectada com conta própria):**
- O endpoint e o corpo vazio foram aceitos como chamada válida: o Mercado Pago respondeu `400` com a causa `120065` ("Collector hasn't enough available money"), não `404`/`422`.
- A recusa por falta de saldo disponível também ocorre no app do Mercado Pago da lojista, mesmo com saldo visível maior que o valor. O motivo exato (saldo "a liberar", rendimento, regra de marketplace) **não foi esclarecido**; o teste de devolução concluída continua pendente.
- A comissão `application_fee` (R$ 0,03) chegou na conta dona do app e ficou em "Dinheiro a liberar".
- Tratamento: `120065` vira "A conta Mercado Pago da loja não tem saldo disponível para devolver este Pix…" (424, ≤ 200 caracteres). Até o fluxo estar validado, devolução de cliente pode ser feita fora do sistema; a cobrança segue `pago` no Vertumno.


## Link de pagamento de cartão (migration 079)

Mesma tabela `cobrancas_pagamento`, `metodo = 'cartao_link'`. Fluxo:

1. `POST /pagamentos-gateway/cartao` `{ valor }` (admin/vendedor; empresa do JWT) → cria a cobrança e a preferência do Checkout Pro com o token OAuth da loja. Resposta: `codigo`, `link_url`, `parcelas_maximas` (12), `expira_em(_segundos)`, `status`. Nunca devolve taxa nem ids do provedor.
2. O cliente abre `link_url` e paga na página do Mercado Pago (crédito ou débito).
3. `GET /pagamentos-gateway/:codigo` (PDV, a cada poucos segundos) e o webhook consultam `GET /v1/payments/search?external_reference=<codigo>` com o token da loja. Só vale pagamento **aprovado**, com a nossa referência, de cartão (`credit_card`/`debit_card`) e valor exato. Grava `id_externo`, `tipo_cartao` e `parcelas` (débito = 1) a partir do pagamento. Tentativa recusada não fecha a cobrança: o cliente pode tentar de novo no mesmo link.
4. A venda (`POST /vendas`) envia `{ forma_pagamento: 'credito'|'debito', numero_parcelas, valor, cobranca_codigo }`; o backend confere empresa, status `pago`, valor, forma e parcelas **contra o pagamento confirmado**, uma única vez. A origem `gateway` só nasce aí.

Webhook: para pagamento sem cobrança ligada ainda, a loja vem do `user_id` da notificação, o pagamento é lido com o token DELA e o `external_reference` liga à cobrança. Nada do corpo recebido é gravado.

**Taxa da plataforma**: 0 no cartão (decisão do PO: a taxa incide só no Pix). O cliente já envia `marketplace_fee` apenas se `taxaPlataforma > 0` (documentado para Checkout Pro marketplace, com o token do vendedor), então ligar a taxa depois não exige mudança de contrato; exige decisão de percentual (regra de negócio).

**Fora do escopo desta entrega**: devolução de pagamento de cartão (recusada com 409; fazer pelo painel do Mercado Pago), maquininha integrada (Fase 3, pesquisa).

### Experiência do cliente no link (ajustes de 31/10/2026)

- Título do item = nome da empresa; `statement_descriptor` = nome sem acento, até 16 caracteres; `back_urls` (sucesso/pendente/falha) apontam para `MP_FRONTEND_URL/pagamento-recebido`, com `auto_return=approved`; `binary_mode=true`; `default_installments=1`.
- A página `/pagamento-recebido` é só informativa: o resultado na URL **não confirma nada**. A confirmação continua sendo webhook/consulta ao Mercado Pago.
- O nome que aparece ao lado do valor na tela do Mercado Pago ("Graziela Doces" no teste) é o nome da **conta Mercado Pago do vendedor**, não é controlável por nós.

### Ainda NÃO confirmado (validar com cobrança real de R$ 1 na conta da loja)

- `binary_mode`, `default_installments`, `statement_descriptor`, `back_urls`/`auto_return` aceitos na criação com o token da loja (se o Mercado Pago recusar algum, o log do Render mostra a causa).

- Criação da preferência com o **token OAuth da loja** (não só credenciais da aplicação) e aceitação de `payment_methods.installments = 12`.
- Se o **débito** aparece no link e se os demais ids de `excluded_payment_types` estão corretos. Confirmado no teste real (31/10/2026): `account_money` **não pode** ser excluído (400); o saldo em conta do comprador entra como débito.
- Se `transaction_amount` do pagamento continua igual ao valor do item quando o comprador paga juros do parcelamento (se vier maior, a cobrança nunca confirma: ajustar a comparação).
- Quem paga o juro do parcelamento (configuração da conta do vendedor no Mercado Pago) e o parcelamento máximo disponível.
- Endereço do link (`init_point`) em produção e comportamento da expiração (`expiration_date_from/to`).
