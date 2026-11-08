# Loja online — catálogo público e marcação de produto (fatia 1)

Canal e-commerce da Cherry. **Esta fatia entrega só o catálogo público e a marcação de produto.** Reserva de estoque, pedido, pagamento, webhook e frete entram nas fatias seguintes; nada disso existe ainda.

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
2. Definir `LOJA_CORS_ORIGINS` com o endereço da loja, quando ela existir.
3. Ligar `loja_online` para a Cherry no Painel.
Aplicar só pelo responsável; nada disto foi aplicado em produção.
