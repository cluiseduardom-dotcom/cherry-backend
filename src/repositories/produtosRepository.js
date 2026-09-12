const db = require('../config/db');

async function listar(empresa_id) {
    const { rows } = await db.query('SELECT * FROM produtos WHERE empresa_id = $1', [empresa_id]);
    return rows;
}

async function listarPaginado({ limit, offset, empresa_id }) {
    const { rows } = await db.query(
        'SELECT * FROM produtos WHERE empresa_id = $1 ORDER BY id LIMIT $2 OFFSET $3',
        [empresa_id, limit, offset]
    );

    const { rows: countRows } = await db.query(
        'SELECT COUNT(*) FROM produtos WHERE empresa_id = $1',
        [empresa_id]
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function criar({ sku, nome, descricao, categoria, preco_venda, custo, estoque_atual, estoque_minimo, ativo, tipo, unidade, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (sku, nome, descricao, categoria, preco_venda, custo, estoque_atual, estoque_minimo, ativo, tipo, unidade, empresa_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
            sku ?? null,
            nome,
            descricao ?? null,
            categoria ?? null,
            preco_venda,
            custo,
            estoque_atual ?? 0,
            estoque_minimo ?? 0,
            ativo ?? true,
            tipo ?? 'acabado',
            unidade ?? 'UN',
            empresa_id
        ]
    );

    return rows[0];
}

async function atualizar(id, dados, empresa_id) {
    // estoque_atual is deliberately excluded: it's only ever changed via estoqueRepository.criarMovimentacao
    const campos = ['sku', 'nome', 'descricao', 'categoria', 'preco_venda', 'custo', 'estoque_minimo', 'ativo', 'tipo', 'unidade'];

    const sets = [];
    const valores = [];
    let i = 1;

    for (const campo of campos) {
        if (dados[campo] !== undefined) {
            sets.push(`${campo} = $${i}`);
            valores.push(dados[campo]);
            i++;
        }
    }

    valores.push(id, empresa_id);

    const { rows } = await db.query(
        `UPDATE produtos SET ${sets.join(', ')} WHERE id = $${i} AND empresa_id = $${i + 1} RETURNING *`,
        valores
    );

    return rows.length ? rows[0] : null;
}

async function desativar(id, empresa_id) {
    const { rows } = await db.query(
        `UPDATE produtos SET ativo = false WHERE id = $1 AND empresa_id = $2 RETURNING *`,
        [id, empresa_id]
    );

    return rows.length ? rows[0] : null;
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        'SELECT * FROM produtos WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function ajustarPreco(id, percentual, empresa_id) {
    const { rows } = await db.query(
        `UPDATE produtos
         SET preco_venda = preco_venda * (1 + $1)
         WHERE id = $2 AND empresa_id = $3
         RETURNING id, nome, preco_venda, custo`,
        [percentual, id, empresa_id]
    );

    return rows.length ? rows[0] : null;
}

async function getGiro(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          COALESCE(SUM(iv.quantidade), 0) AS total_vendido,
          COUNT(DISTINCT DATE(v.data)) AS dias_com_venda
        FROM itens_venda iv
        JOIN produtos p ON p.id = iv.produto_id
        JOIN vendas v ON v.id = iv.venda_id
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome
        ORDER BY total_vendido DESC
    `, [empresa_id]);
    return rows;
}

async function getParados(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          MAX(v.data) AS ultima_venda
        FROM produtos p
        LEFT JOIN itens_venda iv ON iv.produto_id = p.id
        LEFT JOIN vendas v ON v.id = iv.venda_id
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome
        HAVING MAX(v.data) IS NULL
           OR MAX(v.data) < NOW() - INTERVAL '30 days'
    `, [empresa_id]);
    return rows;
}

async function getPricingProfissional(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          p.custo,
          p.preco_venda,
          COALESCE(SUM(iv.quantidade), 0) AS total_vendido,
          CASE
            WHEN COALESCE(SUM(iv.quantidade), 0) >= 20 THEN ROUND(p.custo * 3.0, 2)
            WHEN COALESCE(SUM(iv.quantidade), 0) >= 10 THEN ROUND(p.custo * 2.5, 2)
            ELSE ROUND(p.custo * 2.2, 2)
          END AS preco_sugerido
        FROM produtos p
        LEFT JOIN itens_venda iv ON iv.produto_id = p.id
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome, p.custo, p.preco_venda
        ORDER BY total_vendido DESC
    `, [empresa_id]);
    return rows;
}

// Margem HISTÓRICA (o que já foi vendido) — custo_total/lucro/margem_percentual
// usam iv.custo_unitario, e faturamento/lucro/margem_percentual usam
// iv.preco_unitario, ambos congelados na venda (migration 015; preco_unitario
// já existia e já era gravado desde a criação de vendas — não precisou de
// migration nova). Nenhum dos dois é recalculado a partir de produtos.*
// atual, senão o resultado de vendas já fechadas mudaria toda vez que preço
// ou custo do produto mudassem.
async function getLucroPorProduto(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          COALESCE(SUM(iv.quantidade), 0) AS total_vendido,
          COALESCE(SUM(iv.quantidade * iv.preco_unitario), 0) AS faturamento,
          COALESCE(SUM(iv.quantidade * iv.custo_unitario), 0) AS custo_total,
          COALESCE(SUM(iv.quantidade * (iv.preco_unitario - iv.custo_unitario)), 0) AS lucro,
          ROUND(
            COALESCE(
              (SUM(iv.quantidade * (iv.preco_unitario - iv.custo_unitario)) /
              NULLIF(SUM(iv.quantidade * iv.preco_unitario), 0)) * 100,
            0), 2
          ) AS margem_percentual
        FROM produtos p
        LEFT JOIN itens_venda iv ON iv.produto_id = p.id
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome
        ORDER BY lucro DESC
    `, [empresa_id]);
    return rows;
}

// Margem PROSPECTIVA (se eu vender hoje) de propósito: não junta itens_venda,
// só compara p.preco_venda x p.custo atuais pra alertar produto cujo preço
// vigente já não cobre o custo vigente. Congelar isso em iv.custo_unitario
// cegaria o alerta (ele existe pra reagir a mudança de custo/preço hoje).
async function getAlertaPrejuizo(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          p.custo,
          p.preco_venda,
          (p.preco_venda - p.custo) AS lucro_unitario
        FROM produtos p
        WHERE (p.preco_venda - p.custo) <= 0
          AND p.empresa_id = $1
    `, [empresa_id]);
    return rows;
}

async function getMaisVendidos(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          SUM(iv.quantidade) AS total_vendido,
          SUM(iv.quantidade * iv.preco_unitario) AS faturamento
        FROM itens_venda iv
        JOIN produtos p ON p.id = iv.produto_id
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome
        ORDER BY total_vendido DESC
        LIMIT 10
    `, [empresa_id]);
    return rows;
}

async function getCurvaABC(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          SUM(iv.quantidade * iv.preco_unitario) AS faturamento,
          CASE
            WHEN SUM(iv.quantidade * iv.preco_unitario) >= 1000 THEN 'A'
            WHEN SUM(iv.quantidade * iv.preco_unitario) >= 300 THEN 'B'
            ELSE 'C'
          END AS curva
        FROM itens_venda iv
        JOIN produtos p ON p.id = iv.produto_id
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome
    `, [empresa_id]);
    return rows;
}

async function getReposicao(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          COALESCE(SUM(iv.quantidade),0) AS vendido,
          CASE
            WHEN COALESCE(SUM(iv.quantidade),0) < 5 THEN 'REPOR URGENTE'
            WHEN COALESCE(SUM(iv.quantidade),0) < 10 THEN 'ATENÇÃO'
            ELSE 'OK'
          END AS status
        FROM produtos p
        LEFT JOIN itens_venda iv ON iv.produto_id = p.id
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome
    `, [empresa_id]);
    return rows;
}

async function getSugestaoPreco(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          p.custo,
          p.preco_venda,
          CASE
            WHEN COALESCE(SUM(iv.quantidade),0) >= 20 THEN p.custo * 4
            WHEN COALESCE(SUM(iv.quantidade),0) >= 10 THEN p.custo * 3.5
            ELSE p.custo * 3.2
          END AS preco_sugerido
        FROM produtos p
        LEFT JOIN itens_venda iv ON iv.produto_id = p.id
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome, p.custo, p.preco_venda
    `, [empresa_id]);
    return rows;
}

async function getInteligencia(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          COALESCE(SUM(iv.quantidade), 0) AS total_vendido,
          (p.preco_venda - p.custo) AS lucro_unitario,
          CASE
            WHEN COALESCE(SUM(iv.quantidade),0) >= 20 AND (p.preco_venda - p.custo) > 0 THEN 'MANTER'
            WHEN COALESCE(SUM(iv.quantidade),0) >= 10 THEN 'AJUSTAR PREÇO'
            ELSE 'LIQUIDAR'
          END AS decisao
        FROM produtos p
        LEFT JOIN itens_venda iv ON iv.produto_id = p.id
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome, p.custo, p.preco_venda
    `, [empresa_id]);
    return rows;
}

async function getAcoes(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          COALESCE(SUM(iv.quantidade), 0) AS total_vendido,
          CASE
            WHEN COALESCE(SUM(iv.quantidade),0) >= 20 THEN 'Aumentar preço em 10%'
            WHEN COALESCE(SUM(iv.quantidade),0) >= 10 THEN 'Revisar margem'
            ELSE 'Criar promoção'
          END AS acao
        FROM produtos p
        LEFT JOIN itens_venda iv ON iv.produto_id = p.id
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome
    `, [empresa_id]);
    return rows;
}

async function getDashboard(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          COUNT(*) AS total_vendas,
          COALESCE(SUM(total), 0) AS faturamento,
          COALESCE(AVG(total), 0) AS ticket_medio
        FROM vendas
        WHERE empresa_id = $1
    `, [empresa_id]);
    return rows[0];
}

async function buscarCategoriasDoProduto(produto_id, empresa_id) {
    const { rows } = await db.query(
        `SELECT c.id, c.nivel, c.codigo, c.nome
         FROM produtos_categorias pc
         JOIN categorias_produto c ON c.id = pc.categoria_id
         WHERE pc.produto_id = $1 AND pc.empresa_id = $2
         ORDER BY c.nivel ASC`,
        [produto_id, empresa_id]
    );
    return rows;
}

async function buscarCategoriasPorProdutoIds(produtoIds, empresa_id) {
    if (!produtoIds.length) return [];

    const { rows } = await db.query(
        `SELECT pc.produto_id, c.id, c.nivel, c.codigo, c.nome
         FROM produtos_categorias pc
         JOIN categorias_produto c ON c.id = pc.categoria_id
         WHERE pc.produto_id = ANY($1::int[]) AND pc.empresa_id = $2
         ORDER BY c.nivel ASC`,
        [produtoIds, empresa_id]
    );
    return rows;
}

async function substituirCategorias(produto_id, categoriaIds, empresa_id, client) {
    await client.query('DELETE FROM produtos_categorias WHERE produto_id = $1 AND empresa_id = $2', [produto_id, empresa_id]);

    for (const categoria_id of categoriaIds) {
        await client.query(
            'INSERT INTO produtos_categorias (produto_id, categoria_id, empresa_id) VALUES ($1, $2, $3)',
            [produto_id, categoria_id, empresa_id]
        );
    }
}

async function definirSkuSeNulo(produto_id, sku, empresa_id, client) {
    const { rows } = await client.query(
        'UPDATE produtos SET sku = $1 WHERE id = $2 AND empresa_id = $3 AND sku IS NULL RETURNING *',
        [sku, produto_id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

module.exports = {
    listar,
    listarPaginado,
    criar,
    atualizar,
    desativar,
    buscarPorId,
    ajustarPreco,
    getGiro,
    getParados,
    getPricingProfissional,
    getLucroPorProduto,
    getAlertaPrejuizo,
    getMaisVendidos,
    getCurvaABC,
    getReposicao,
    getSugestaoPreco,
    getInteligencia,
    getAcoes,
    getDashboard,
    buscarCategoriasDoProduto,
    buscarCategoriasPorProdutoIds,
    substituirCategorias,
    definirSkuSeNulo
};
