const db = require('../config/db');

// Curva ABC por faturamento (Pareto): produtos ordenados por faturamento
// decrescente, classificados pelo percentual acumulado de faturamento total —
// A até 80%, B até 95%, C o restante. Só considera itens de vendas
// 'finalizada' (vendas canceladas não contam como faturamento).
async function getCurvaABC(empresa_id) {
    const { rows } = await db.query(`
        WITH vendas_validas AS (
            SELECT iv.produto_id, iv.quantidade, iv.preco_unitario
            FROM itens_venda iv
            JOIN vendas v ON v.id = iv.venda_id
            WHERE v.status = 'finalizada' AND v.empresa_id = $1
        ),
        faturamento_produto AS (
            SELECT
                p.id,
                p.nome,
                COALESCE(SUM(vv.quantidade * vv.preco_unitario), 0) AS faturamento
            FROM produtos p
            LEFT JOIN vendas_validas vv ON vv.produto_id = p.id
            WHERE p.ativo = true AND p.empresa_id = $1
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
    `, [empresa_id]);

    return rows;
}

// Giro = unidades vendidas no período / estoque atual (quantas vezes o estoque
// atual "virou" no período analisado). Cobertura em dias = estoque atual /
// média diária vendida no período (quantos dias o estoque atual ainda dura,
// no ritmo observado). Ambos nulos quando não há base de cálculo (estoque
// zerado para giro; nada vendido no período para cobertura).
async function getGiroECobertura(dias, empresa_id) {
    const { rows } = await db.query(
        `WITH vendidos_periodo AS (
            SELECT iv.produto_id, SUM(iv.quantidade) AS quantidade_vendida
            FROM itens_venda iv
            JOIN vendas v ON v.id = iv.venda_id
            WHERE v.status = 'finalizada' AND v.data >= NOW() - ($1::text || ' days')::interval
              AND v.empresa_id = $2
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
        WHERE p.ativo = true AND p.empresa_id = $2
        ORDER BY p.id`,
        [dias, empresa_id]
    );

    return rows;
}

// Mesma base de getGiroECobertura (produto ativo, vendas 'finalizada' no
// período, escopado por empresa), mas devolve os valores CRUS — sem
// giro/cobertura calculados em SQL — e inclui sku. O relatório agregado
// (GET /dashboard/giro-cobertura) soma esses valores por grupo ANTES de
// dividir (ver src/utils/agregacaoGiroCobertura.js); calcular giro/cobertura
// aqui em SQL faria por produto individual, que é exatamente a média de
// razões que a regra de agregação proíbe pro nível de grupo.
async function getVendasEstoquePorProduto(dias, empresa_id) {
    const { rows } = await db.query(
        `WITH vendidos_periodo AS (
            SELECT iv.produto_id, SUM(iv.quantidade) AS quantidade_vendida
            FROM itens_venda iv
            JOIN vendas v ON v.id = iv.venda_id
            WHERE v.status = 'finalizada' AND v.data >= NOW() - ($1::text || ' days')::interval
              AND v.empresa_id = $2
            GROUP BY iv.produto_id
        )
        SELECT
            p.id,
            p.nome,
            p.sku,
            p.estoque_atual,
            COALESCE(vp.quantidade_vendida, 0) AS quantidade_vendida_periodo
        FROM produtos p
        LEFT JOIN vendidos_periodo vp ON vp.produto_id = p.id
        WHERE p.ativo = true AND p.empresa_id = $2
        ORDER BY p.id`,
        [dias, empresa_id]
    );

    return rows;
}

// Vínculos produto->categoria pra quebra por nível do relatório de giro e
// cobertura. NÃO filtra categoria soft-deletada (deletado_em): o vínculo em
// produtos_categorias não cascade-deleta (mesma regra já usada em GET
// /produtos), então uma categoria removida continua contribuindo pro grupo
// dela aqui até o produto ser recategorizado.
async function getVinculosCategoriasProdutos(empresa_id) {
    const { rows } = await db.query(
        `SELECT pc.produto_id, cp.id AS categoria_id, cp.nivel, cp.nome AS categoria_nome
         FROM produtos_categorias pc
         JOIN categorias_produto cp ON cp.id = pc.categoria_id
         WHERE pc.empresa_id = $1`,
        [empresa_id]
    );

    return rows;
}

// Níveis "existentes" pra empresa = todo nível com pelo menos uma categoria
// ATIVA cadastrada, independente de já ter produto vinculado a ele. Não vem
// de niveis_categoria (tabela independente que só fornece o rótulo — pode
// ter um nível "nomeado" sem nenhuma categoria criada ainda, o que não
// deveria gerar uma quebra vazia no relatório).
async function getNiveisExistentes(empresa_id) {
    const { rows } = await db.query(
        `SELECT DISTINCT nivel FROM categorias_produto
         WHERE empresa_id = $1 AND deletado_em IS NULL
         ORDER BY nivel ASC`,
        [empresa_id]
    );

    return rows.map((row) => row.nivel);
}

module.exports = {
    getCurvaABC,
    getGiroECobertura,
    getVendasEstoquePorProduto,
    getVinculosCategoriasProdutos,
    getNiveisExistentes
};
