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
| `MP_SANDBOX` | `true` envia `test_token` no OAuth | não |
| `MP_API_URL` / `MP_AUTH_URL` | Opcionais (padrão `api.mercadopago.com` / `auth.mercadopago.com`) | não |

Perder `MP_TOKEN_ENC_KEY` invalida os tokens guardados (as lojas precisam reconectar). Trocá-la tem o mesmo efeito.

## Endpoints
| Rota | Quem | O que faz |
|---|---|---|
| `GET /integracoes/mercadopago` | admin | `{configurado, conectado, conectado_em}` (nunca tokens) |
| `POST /integracoes/mercadopago/conectar` | admin | devolve `{url}` de autorização; grava `state` de uso único (10 min) |
| `GET /integracoes/mercadopago/callback` | público (por `state`) | troca o código, guarda tokens cifrados, redireciona a `MP_FRONTEND_URL/configuracoes/empresa?mercadopago=conectado\|erro` |
| `DELETE /integracoes/mercadopago` | admin | desconecta e apaga os tokens |
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
