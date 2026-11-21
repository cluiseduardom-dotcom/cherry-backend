# Grade de produtos (variações de tamanho, cor...)

Funcionalidade `grade` (todas as rotas exigem; sem ela, 403). Migration 125 a torna ligável pela GiroNex; nenhum plano a inclui.

## Desenho
Cada **variação é um produto normal**: SKU, estoque, preço, fotos e vendas próprios. Ela só fica ligada a uma **grade**
(o "produto pai": nome, descrição, eixos) e guarda os valores da variação. Estoque, PDV, vendas e financeiro **não mudam**;
produto sem grade segue como era. Variação de grade aparece em `GET /produtos` com `grade_id` e `variacao`
(`{"Tamanho": "P", "Cor": "Azul"}`); produto comum traz os dois `null`.

- `grades_produto`: `nome` (único por empresa, sem diferenciar maiúsculas), `descricao`, `eixos` (1 a 3, ex.: `["Tamanho","Cor"]`),
  padrões herdados pelas variações novas (`custo`, `preco_venda`, `unidade`, `estoque_minimo`) e `categorias_comuns`.
- `produtos.grade_id` e `produtos.variacao`: ou os dois nulos ou os dois preenchidos; a mesma combinação não se repete na grade (índice único).

## Rotas
| Rota | Quem | O que faz |
|---|---|---|
| `POST /grades` | admin | cria a grade e uma variação por combinação, numa transação. `{ nome, descricao?, eixos, custo, preco_venda?, unidade?, estoque_minimo?, categoria_ids?, variacoes: [{ valores, categoria_ids?, custo? }] }` (1 a 100 variações) |
| `POST /grades/:id/variacoes` | admin | acrescenta variações (herdam os padrões da grade; `custo` próprio opcional). Combinação repetida (sem diferenciar maiúsculas) = 409 e nenhuma entra |
| `PATCH /grades/:id` | admin | muda `nome` e/ou `descricao`. Eixos não mudam |
| `GET /grades`, `GET /grades/:id` | admin, estoquista | lista (nº de variações e estoque total) e detalhe com cada variação. `custo` só para quem vê custos |

## Regras
- Nome da variação = `<grade> <valor1> / <valor2>` (ex.: `Camiseta Básica P / Azul`).
- Cada variação nasce com **estoque 0** (nunca lança estoque; a entrada é por Compra, Recebimento ou Estoque inicial).
- **SKU** pelo caminho de sempre: `categoria_ids` comuns (ex.: o Tipo) + `categoria_ids` da variação (ex.: o Tamanho). Ex.: `CAM-P-001`; a mesma combinação de categorias recebe a próxima sequência. As categorias são validadas **antes** de criar qualquer coisa (inexistente, de outra empresa, de insumo ou dois níveis iguais = 400). Sem categorias, a variação nasce sem SKU e pode ser categorizada depois.
- Valores: exatamente os eixos da grade, cada um com 1 a 40 caracteres; combinação repetida no corpo = 400.
- `empresa_id` nunca vem do corpo (campo desconhecido = 400). Grade de outra empresa = 404.

## Fora desta entrega
Tela (frontend), seletor de tamanho/cor no PDV (hoje cada variação aparece como um produto), preço por variação em massa,
remover uma variação da grade, e estoque inicial por variação na criação.
