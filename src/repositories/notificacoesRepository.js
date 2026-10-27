const db = require('../config/db');

// Uma linha por produto ativo da empresa, com os números que as regras do sino usam.
// Só vendas finalizadas contam. Tudo filtrado por empresa_id nas próprias consultas.
async function listarBaseDeProdutos(empresa_id) {
    const { rows } = await db.query(
        `WITH vendas_produto AS (
            SELECT iv.produto_id,
                   COALESCE(SUM(iv.quantidade) FILTER (WHERE v.data >= NOW() - INTERVAL '30 days'), 0)::int AS vendido_30d,
                   COALESCE(SUM(iv.quantidade) FILTER (WHERE v.data >= NOW() - INTERVAL '90 days'), 0)::int AS vendido_90d,
                   FLOOR(EXTRACT(EPOCH FROM (NOW() - MAX(v.data))) / 86400)::int AS dias_sem_venda
            FROM itens_venda iv
            JOIN vendas v ON v.id = iv.venda_id AND v.empresa_id = $1 AND v.status = 'finalizada'
            GROUP BY iv.produto_id
        ),
        primeira_movimentacao AS (
            SELECT produto_id,
                   FLOOR(EXTRACT(EPOCH FROM (NOW() - MIN(criado_em))) / 86400)::int AS dias_cadastro
            FROM movimentacoes_estoque
            WHERE empresa_id = $1
            GROUP BY produto_id
        )
        SELECT p.id, p.sku, p.nome, p.tipo, p.estoque_atual, p.estoque_minimo,
               COALESCE(vp.vendido_30d, 0) AS vendido_30d,
               COALESCE(vp.vendido_90d, 0) AS vendido_90d,
               vp.dias_sem_venda,
               COALESCE(pm.dias_cadastro, 0) AS dias_cadastro
        FROM produtos p
        LEFT JOIN vendas_produto vp ON vp.produto_id = p.id
        LEFT JOIN primeira_movimentacao pm ON pm.produto_id = p.id
        WHERE p.ativo = true AND p.empresa_id = $1
        ORDER BY p.id`,
        [empresa_id]
    );

    return rows;
}

module.exports = { listarBaseDeProdutos };
