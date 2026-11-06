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
`id` é estável (`tipo:produto_id`) para o frontend marcar como lida. Ordenação: prioridade (alta, média, baixa), depois `produto_id` (avisos sem produto vêm depois, por `id`). Máximo de 50 itens, somando produtos e maletas: avisos altos de produto (falta, abaixo do mínimo) podem ocupar o teto antes dos de maleta.

## Regras (limites em `src/utils/notificacoes.js`, `LIMITES`)
| Tipo | Prioridade | Regra |
|---|---|---|
| `falta` | alta | estoque = 0 e (mínimo > 0 ou vendeu nos últimos 90 dias) |
| `abaixo_minimo` | alta | mínimo > 0 e 0 < estoque ≤ mínimo |
| `perto_de_acabar` | média | cobertura ≤ 7 dias (estoque ÷ média diária dos últimos 30 dias); não repete se já está `abaixo_minimo` |
| `parado` | baixa | produto acabado, estoque > 0, sem venda há ≥ 90 dias (ou nunca vendeu) **e** primeira movimentação de estoque há ≥ 90 dias |
| `alto_giro` | baixa | top 3 produtos acabados com giro (vendido em 90 dias ÷ estoque) ≥ 1 |
| `insumo_pendente` | alta | insumo da ficha de venda sem saldo no Central em vendas finalizadas (admin e estoquista) |

Só vendas `finalizada` contam (cancelada não conta). Insumos (`tipo = 'insumo'`) só entram em `falta`, `abaixo_minimo` e
`perto_de_acabar`. O aviso `insumo_pendente` (alta) — insumo que não tinha saldo no Central na hora de uma venda, uma linha por insumo com a soma pendente e o nº de vendas — vem de `venda_consumos` (ver `docs/CONSUMO_INSUMOS_VENDA.md`); some quando a venda é cancelada.

## Avisos de maleta (só empresas com a funcionalidade `maletas`)
Mesma rota, sem migration. Sem a funcionalidade ligada (lista da sessão), as consultas nem rodam. Os avisos não têm produto: `produto_id`, `sku` e `nome` vêm `null`, `item` = `maleta`, e o `id` é `tipo:local_id` (ou `tipo:transferencia_id`). Trazem `local_id` ou `transferencia_id`.

| Tipo | Prioridade | Regra |
|---|---|---|
| `transferencia_pendente` | alta | transferência `pendente` há ≥ 2 dias |
| `maleta_divergencia` | alta | a **última** conferência da maleta tem diferença e o ajuste não foi aplicado (uma conferência posterior sem diferença encerra o aviso) |
| `maleta_sem_conferencia` | média | saldo > 0 e ≥ 30 dias desde a última conferência; sem nenhuma, desde o **primeiro** recebimento aceito |
| `maleta_sem_venda` | média | saldo > 0 e ≥ 30 dias desde a última venda finalizada da maleta **ou** o último recebimento aceito (o mais recente) |

Sem data de referência (ex.: maleta que nunca recebeu transferência aceita) não há aviso de conferência/venda. Venda cancelada não conta. Maleta inativa não entra. Limites em `src/utils/notificacoesMaleta.js` (`LIMITES_MALETA`).

Quem recebe: equipe (admin/estoquista) vê tudo; os demais, só a **própria** maleta e as transferências em que são o dono do destino. `maleta_divergencia` é só da equipe. Nunca traz custo, margem ou lucro. O acerto não é gravado, por isso a "conferência" é o único sinal persistido de maleta conferida.

## Quem recebe o quê (RBAC)
- **Admin** (perfil admin, por cargo ou concessão): todos os tipos, produtos e insumos.
- **Estoquista**: `falta`, `abaixo_minimo`, `perto_de_acabar` (produtos e insumos) e `insumo_pendente`. Sem `parado`/`alto_giro` (derivam de vendas).
- **Demais perfis** (vendedor etc.): só `falta` e `abaixo_minimo` de produtos; nunca insumos.
- Nenhum perfil recebe custo, margem ou lucro.

## Limitações conhecidas
- "Lida/dispensada" não é persistida no servidor nesta fatia (o frontend guarda localmente).
- Limites fixos (7 / 30 / 90 dias, top 3); tornar configurável por empresa é evolução futura.
- A idade do produto vem da 1ª movimentação de estoque, pois `produtos` não tem data de criação.
