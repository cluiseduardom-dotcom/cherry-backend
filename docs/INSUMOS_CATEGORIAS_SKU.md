# Insumos: categorização e SKU próprios (migration 094)

Categorias (`categorias_produto`), rótulos de nível (`niveis_categoria`) e padrões de SKU (`configuracoes_sku`) têm `escopo`:
`produto` (padrão, contrato antigo) ou `insumo`. Cada padrão de SKU tem a sua sequência (`sequencias_sku` por `configuracao_id`),
então a numeração de insumos nunca se mistura com a de produtos.

- Leitura: `GET /categorias`, `GET /niveis-categoria`, `GET /configuracoes-sku` e `GET /configuracoes-sku/padroes` aceitam `?escopo=insumo`.
  Sem o parâmetro, vale `produto`. Valor inválido: 400.
- Escrita: `POST /categorias`, `POST /niveis-categoria` e `PUT /configuracoes-sku` aceitam `escopo` no corpo (padrão `produto`).
  Editar/remover categoria e nível continua por `id` da própria empresa.
- Unicidade do código da categoria: por (empresa, escopo, nível, código). `EMB` pode existir em produto e em insumo.
- `PATCH /produtos/:id/categoria`: insumo só aceita categorias de insumo e produto acabado só as de produto (400 caso contrário);
  o SKU é gerado com o padrão do escopo do produto, uma vez, e é imutável.

## Carga inicial (migration 094 e onboarding de empresa nova)
Padrão `Insumos` (numérico, separador `-`, 3 dígitos), segmentos Família (nível 1, obrigatório) e Tamanho (nível 2, opcional),
rótulos Família/Tamanho e as famílias EMB (Embalagem), ETQ (Etiqueta / Tag) e MAT (Material). A empresa edita tudo isso.
Exemplos de SKU: `EMB-001`, `ETQ-001`; com Tamanho: `EMB-P-001`.
