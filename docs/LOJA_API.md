# Loja online — catálogo, marcação de produto, reserva de estoque e pedidos (fatias 1 e 2)

Canal e-commerce da Cherry. **Entregue até aqui:** catálogo público, marcação de produto, reserva de estoque e pedido do visitante (fatias 1 e 2). **Ainda não existem:** pagamento, webhook, conversão do pedido em venda, cancelamento pela cliente, endereço de entrega e frete.

O Vertumno continua sendo a única fonte de preço e estoque. A tabela `produtos_loja` guarda apenas *quais produtos aparecem* e o texto editorial; não tem preço, saldo nem custo (a migration 095 tem teste que garante isso).

## Ligar a loja para uma empresa
- Funcionalidade `loja_online` (módulo, migration 095). **Desligada para todas as empresas**; nenhum plano a inclui.
- A GiroNex liga avulsa pelo Painel (`empresa_funcionalidades`, com vigência). Desligar vence, como nas demais funcionalidades.
- Sem a funcionalidade: rotas públicas respondem **404** e as de gestão **403**.
- `LOJA_CORS_ORIGINS` (variável de ambiente, opcional): origens do site da loja, separadas por vírgula. Em produção/staging, origem fora da lista é rejeitada pelo CORS.

## Rotas públicas (sem login, somente GET)
Base: `/loja/:slug/...`, onde `:slug` é o identificador público da empresa (`empresas.slug`, ex.: `cherry`). **A empresa é decidida no servidor** pelo slug e só responde se estiver `ativa` com `loja_online` ligada. Slug malformado, inexistente, de empresa inativa ou sem a funcionalidade respondem o mesmo `404 {"success":false,"message":"Loja não encontrada"}` (a rota não serve de sonda de empresas). Limite de 120 requisições por minuto por IP (`429`). `Cache-Control: public, max-age=15`.

| Rota | Resposta (`data`) |
|---|---|
| `GET /catalogo` | `{ itens: Produto[], total, pagina, limite }` |
| `GET /produtos/:produtoSlug` | `Produto` (404 se não visível, inativo, sem preço online ou de outra empresa) |
| `GET /categorias` | `[{ nivel, codigo, nome, quantidade }]` só de categorias com produto visível |
| `GET /vitrines` | `{ novidades: Produto[], mais_vendidos: Produto[] }` (até 8 cada) |

### Query do `/catalogo`
| Parâmetro | Valores |
|---|---|
| `n1`, `n2`, `n3` | código da categoria do nível 1, 2 ou 3 (1 a 3 letras/números; ex.: `n1=ANE&n2=BO`) |
| `q` | busca por nome/título/descrição da loja; 2 a 60 caracteres; `%` e `_` valem como texto |
| `preco_min`, `preco_max` | número ≥ 0; `min ≤ max` |
| `novidades`, `disponivel` | `true`/`false`/`1`/`0` |
| `ordem` | `destaque` (padrão), `novidades`, `mais_vendidos`, `preco_asc`, `preco_desc`, `nome` |
| `pagina`, `limite` | padrão 1 e 24; limite máximo 48 |

Valor inválido responde `400` com mensagem em português. Parâmetro desconhecido é ignorado.

### `Produto`
```json
{
  "slug": "anel-solitario-regulavel-zirconia-banhado-a-ouro-5",
  "nome": "...", "descricao": null, "materiais": null, "cuidados": null,
  "preco": 63.0,
  "disponivel": true, "quantidade_disponivel": 2, "novidade": true,
  "categorias": [{ "nivel": 1, "codigo": "ANE", "nome": "Anel" }],
  "imagens": ["https://.../foto.jpg"]
}
```
Lista fixa de campos. **Nunca saem:** custo, margem, markup, fornecedor, estoque por local, estoque mínimo, id interno de produto ou empresa, e o texto interno `produtos.descricao` (a descrição da loja é outro campo, vazio até alguém preencher). `materiais` e `cuidados` nascem vazios: o sistema não inventa esses textos.

### Regras de negócio
- **Entra no catálogo** o produto `acabado`, ativo, marcado como visível e com preço no canal `online`.
- **Preço:** o preço vigente do canal `online` (o registro mais recente, mesma regra do PDV).
- **Disponibilidade:** só o saldo do local **Central**. Maleta, consignado e Em trânsito não contam. `quantidade_disponivel` é limitada a 10 (a loja não conhece o saldo real acima disso).
- **Novidade:** a *primeira* entrada de estoque (qualquer origem) foi nos últimos **30 dias**.
- **Mais vendidos:** por vendas finalizadas (cancelada não conta). A lista só vem preenchida com **pelo menos 4 peças** com venda; antes disso, `[]`. A API nunca informa quantas foram vendidas.
- **Promoções:** fora da Fase 1 (o Vertumno não tem preço promocional).
- **Revalidar no checkout:** estes dados podem ficar até 15 s defasados; o pedido (fatia seguinte) sempre revalida preço e estoque no servidor.

## Pedido do visitante (fatia 2)

| Rota | Efeito |
|---|---|
| `POST /loja/:slug/pedidos` | cria o pedido e **reserva** o estoque |
| `GET /loja/:slug/pedidos/:codigo` | acompanha o pedido pelo código (UUID) |

### `POST /pedidos`
Cabeçalho obrigatório `Idempotency-Key` (8 a 80 caracteres: letras, números, `-`, `_`). Limite de 10 pedidos por minuto por IP. Corpo **estrito** (qualquer campo extra, como `empresa_id`, `total`, `frete` ou `desconto`, é 400):
```json
{
  "cliente": { "nome": "Maria", "email": "maria@exemplo.com", "telefone": "(11) 91234-5678" },
  "itens": [ { "slug": "anel-solitario-5", "quantidade": 2, "preco_exibido": 63.00 } ]
}
```
- Até 20 itens, 1 a 10 unidades por item, sem item repetido. `telefone` é opcional.
- **`preco_exibido` não é o preço cobrado.** O servidor grava o preço vigente do canal `online`; o campo só serve para detectar que o preço mudou desde que a cliente viu.
- **201** com o pedido (abaixo). **200** com `Idempotent-Replayed: true` se a mesma chave com o mesmo conteúdo já criou o pedido (nada é reservado de novo).

| Status | `codigo` | Quando |
|---|---|---|
| 400 | (sem) | corpo ou cabeçalho inválido |
| 404 | (sem) | loja inexistente, inativa ou sem `loja_online` |
| 409 | `ITENS_ALTERADOS` | algum item mudou; `detalhes` lista `{slug, problema}` com `indisponivel`, `estoque_insuficiente` (+`disponivel`) ou `preco_alterado` (+`preco_atual`). **Nada é reservado** (tudo ou nada) |
| 409 | `CHAVE_REUTILIZADA` | mesma chave com conteúdo diferente |
| 409 | `LIMITE_PEDIDOS_ABERTOS` | 3 pedidos aguardando pagamento para o mesmo e-mail |
| 429 | (sem) | limite por IP |

### Pedido (`data`)
```json
{
  "codigo": "6f1c...-uuid", "status": "aguardando_pagamento",
  "itens": [ { "slug": "...", "nome": "...", "quantidade": 2, "preco_unitario": 63.0, "subtotal": 126.0 } ],
  "subtotal": 126.0, "desconto": 0, "frete": null, "total": 126.0,
  "reserva_expira_em": "2026-11-08T14:30:00.000Z", "criado_em": "...", "pago_em": null
}
```
`frete: null` significa **a combinar** (decisão provisória do PO). A resposta nunca traz e-mail, telefone, nome da cliente, chave de idempotência, hash nem id interno. Estados: `aguardando_pagamento`, `pago`, `cancelado`, `expirado` (hoje só os dois primeiros e `expirado` são alcançáveis).

### Reserva de estoque
- A reserva é um **local de estoque novo**, `Reserva online` (tipo `reserva`, migration 096). Ao criar o pedido, cada peça **sai do Central e entra na Reserva** (duas movimentações comuns no livro, `Reserva online #<id>`); o total `produtos.estoque_atual` não muda.
- O PDV só vende do Central e da própria maleta, então a peça reservada **não pode ser vendida duas vezes**, sem alterar o PDV.
- Concorrência: os produtos são travados em ordem de id (a mesma ordem do PDV, sem deadlock), e preço e saldo são lidos **depois** do travamento. Última unidade disputada por N clientes: exatamente uma leva.
- A Reserva **não aceita** movimentação avulsa, transferência nem venda do PDV (todas recusadas); não aparece nas listas de locais; o saldo por produto continua visível na tela de saldos.
- **Prazo:** 30 minutos (`RESERVA_MINUTOS`, a confirmar com o PO). Vencido, o pedido vira `expirado`, a peça volta ao Central e o pedido continua no histórico, com trilha em `pedidos_loja_eventos` (só de inserção).
- **Quem libera as reservas vencidas:** (1) o próprio `POST`/`GET` do pedido varre as da loja, e (2) o script `scripts/expirar-reservas-loja.js`, para rodar a cada minuto como **Cron Job do Render** (`node scripts/expirar-reservas-loja.js`, mesmas variáveis da API). Sem o cron, uma reserva vencida de uma loja sem movimento só volta ao Central quando alguém acessar o pedido ou criar outro; **o cron é obrigatório no go-live**.

### Idempotência
`(empresa, Idempotency-Key)` é único. Requisições simultâneas com a mesma chave são serializadas: uma cria, as outras recebem o mesmo pedido. A chave guarda uma impressão digital do conteúdo; a mesma chave com outro conteúdo é recusada.

### Freios contra reserva sem pagamento
10 pedidos por minuto por IP, 3 pedidos abertos por e-mail, no máximo 10 unidades por item e 20 itens por pedido. **Risco residual:** quem usar vários e-mails e vários IPs ainda consegue segurar estoque por 30 minutos. A defesa completa (confirmação de e-mail ou captcha) não foi implementada; com peças de 1 ou 2 unidades isso importa e deve ser decidido antes do go-live.

## Rotas de gestão (autenticadas)
| Rota | Quem | Efeito |
|---|---|---|
| `GET /produtos/:id/loja` | admin + `loja_online` | marcação atual (padrão: não visível) |
| `PUT /produtos/:id/loja` | admin + `loja_online` | cria/atualiza: `visivel`, `titulo`, `descricao`, `materiais`, `cuidados`, `ordem` |

- Corpo estrito: preço, estoque, custo ou qualquer campo desconhecido respondem `400`.
- Só produto `acabado` e ativo pode ser publicado (`409`). Produto de outra empresa responde `404`.
- O `slug` é gerado na primeira marcação (`nome-sem-acento-<id>`) e **nunca muda** (URL estável).
- Campos ausentes não são alterados; texto vazio vira `null`.

## Aplicar em produção
1. Migration `095_loja_online.sql` (só acrescenta; reversão manual no rodapé do arquivo).
2. Migration `096_loja_pedidos_reserva.sql`: acrescenta tabelas e **recria as duas constraints de `locais_estoque`** aceitando o tipo `reserva` (relaxamento: nada que valia deixa de valer; trava a tabela por instantes). Reversão manual no rodapé.
3. Criar o **Cron Job do Render** `node scripts/expirar-reservas-loja.js` a cada minuto.
4. Definir `LOJA_CORS_ORIGINS` com o endereço da loja, quando ela existir.
5. Ligar `loja_online` para a Cherry no Painel.
Aplicar só pelo responsável; nada disto foi aplicado em produção.
