# Notificações de decisão (sino) — contrato

`GET /notificacoes` — qualquer usuário autenticado. Sem migration, sem tabela: as mensagens são **calculadas na hora**
a partir do estoque e das vendas finalizadas da empresa do JWT (`req.usuario.empresa_id`; nunca do body/query).

## Resposta
```json
{ "success": true, "data": { "total": 2, "itens": [
  { "id": "falta:12", "tipo": "falta", "prioridade": "alta", "produto_id": 12, "sku": "ANE-001",
    "nome": "Anel", "item": "produto", "titulo": "Item em falta",
    "mensagem": "Anel (SKU ANE-001) está sem estoque.", "acao": "Repor o estoque ou comprar com o fornecedor.",
    "dados": { "estoque_atual": 0, "estoque_minimo": 3 } }
] } }
```
`id` é estável (`tipo:produto_id`) para o frontend marcar como lida. Ordenação: prioridade (alta, média, baixa) e depois `produto_id`. Máximo de 50 itens.

## Regras (limites em `src/utils/notificacoes.js`, `LIMITES`)
| Tipo | Prioridade | Regra |
|---|---|---|
| `falta` | alta | estoque = 0 e (mínimo > 0 ou vendeu nos últimos 90 dias) |
| `abaixo_minimo` | alta | mínimo > 0 e 0 < estoque ≤ mínimo |
| `perto_de_acabar` | média | cobertura ≤ 7 dias (estoque ÷ média diária dos últimos 30 dias); não repete se já está `abaixo_minimo` |
| `parado` | baixa | produto acabado, estoque > 0, sem venda há ≥ 90 dias (ou nunca vendeu) **e** primeira movimentação de estoque há ≥ 90 dias |
| `alto_giro` | baixa | top 3 produtos acabados com giro (vendido em 90 dias ÷ estoque) ≥ 1 |

Só vendas `finalizada` contam (cancelada não conta). Insumos (`tipo = 'insumo'`) só entram em `falta`, `abaixo_minimo` e
`perto_de_acabar`. O aviso de "pendência de consumo" (falta de insumo na venda) entra aqui na fatia do consumo por venda (#150).

## Quem recebe o quê (RBAC)
- **Admin** (perfil admin, por cargo ou concessão): todos os tipos, produtos e insumos.
- **Estoquista**: `falta`, `abaixo_minimo`, `perto_de_acabar` (produtos e insumos). Sem `parado`/`alto_giro` (derivam de vendas).
- **Demais perfis** (vendedor etc.): só `falta` e `abaixo_minimo` de produtos; nunca insumos.
- Nenhum perfil recebe custo, margem ou lucro.

## Limitações conhecidas
- "Lida/dispensada" não é persistida no servidor nesta fatia (o frontend guarda localmente).
- Limites fixos (7 / 30 / 90 dias, top 3); tornar configurável por empresa é evolução futura.
- A idade do produto vem da 1ª movimentação de estoque, pois `produtos` não tem data de criação.
