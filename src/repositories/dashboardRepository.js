const db = require('../config/db');

// Curva ABC por faturamento (Pareto): produtos ordenados por faturamento
// decrescente, classificados pelo percentual acumulado de faturamento total —
// A até 80%, B até 95%, C o restante. Só considera itens de vendas
// 'finalizada' (vendas canceladas não contam como faturamento).
async function getCurvaABC() {
    const { rows } = await db.query(`
        WITH vendas_validas AS (
            SELECT iv.produto_id, iv.quantidade, iv.preco_unitario
            FROM itens_venda iv
            JOIN vendas v ON v.id = iv.venda_id
            WHERE v.status = 'finalizada'
        ),
        faturamento_produto AS (
            SELECT
                p.id,
                p.nome,
                COALESCE(SUM(vv.quantidade * vv.preco_unitario), 0) AS faturamento
            FROM produtos p
            LEFT JOIN vendas_validas vv ON vv.produto_id = p.id
            WHERE p.ativo = true
            GROUP BY p.id, p.nome
        ),
        com_acumulado AS (
            SELECT
                id, nome, faturamento,
                SUM(faturamento) OVER () AS faturamento_total,
                SUM(faturamento) OVER (ORDER BY faturamento DESC, id ROWS UNBOUNDED PRECEDING) AS faturamento_acumulado
            FROM faturamento_produto
        )
        SELECT
            id,
            nome,
            faturamento,
            CASE WHEN faturamento_total > 0 THEN ROUND((faturamento_acumulado / faturamento_total) * 100, 2) ELSE 0 END AS percentual_acumulado,
            CASE
                WHEN faturamento_total = 0 THEN 'C'
                WHEN (faturamento_acumulado / faturamento_total) <= 0.8 THEN 'A'
                WHEN (faturamento_acumulado / faturamento_total) <= 0.95 THEN 'B'
                ELSE 'C'
            END AS curva
        FROM com_acumulado
        ORDER BY faturamento DESC, id
    `);

    return rows;
}

// Giro = unidades vendidas no período / estoque atual (quantas vezes o estoque
// atual "virou" no período analisado). Cobertura em dias = estoque atual /
// média diária vendida no período (quantos dias o estoque atual ainda dura,
// no ritmo observado). Ambos nulos quando não há base de cálculo (estoque
// zerado para giro; nada vendido no período para cobertura).
async function getGiroECobertura(dias) {
    const { rows } = await db.query(
        `WITH vendidos_periodo AS (
            SELECT iv.produto_id, SUM(iv.quantidade) AS quantidade_vendida
            FROM itens_venda iv
            JOIN vendas v ON v.id = iv.venda_id
            WHERE v.status = 'finalizada' AND v.data >= NOW() - ($1::text || ' days')::interval
            GROUP BY iv.produto_id
        )
        SELECT
            p.id,
            p.nome,
            p.estoque_atual,
            COALESCE(vp.quantidade_vendida, 0) AS quantidade_vendida_periodo,
            CASE WHEN p.estoque_atual > 0 THEN ROUND(COALESCE(vp.quantidade_vendida, 0)::numeric / p.estoque_atual, 2) ELSE NULL END AS giro,
            CASE
                WHEN COALESCE(vp.quantidade_vendida, 0) = 0 THEN NULL
                ELSE ROUND(p.estoque_atual / (COALESCE(vp.quantidade_vendida, 0)::numeric / $1::numeric), 1)
            END AS cobertura_dias
        FROM produtos p
        LEFT JOIN vendidos_periodo vp ON vp.produto_id = p.id
        WHERE p.ativo = true
        ORDER BY p.id`,
        [dias]
    );

    return rows;
}

module.exports = {
    getCurvaABC,
    getGiroECobertura
};
