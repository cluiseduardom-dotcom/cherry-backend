const db = require('../config/db');

async function listar() {
    const { rows } = await db.query('SELECT * FROM produtos');
    return rows;
}

async function criar({ nome, preco_venda, custo }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (nome, preco_venda, custo)
         VALUES ($1, $2, $3)
         RETURNING id, nome, preco_venda, custo`,
        [nome, preco_venda, custo]
    );

    return rows[0];
}

async function buscarPorId(id) {
    const { rows } = await db.query('SELECT * FROM produtos WHERE id = $1', [id]);
    return rows.length ? rows[0] : null;
}

async function ajustarPreco(id, percentual) {
    const { rows } = await db.query(
        `UPDATE produtos
         SET preco_venda = preco_venda * (1 + $1)
         WHERE id = $2
         RETURNING id, nome, preco_venda, custo`,
        [percentual, id]
    );

    return rows.length ? rows[0] : null;
}

async function getGiro() {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          COALESCE(SUM(iv.quantidade), 0) AS total_vendido,
          COUNT(DISTINCT DATE(v.data)) AS dias_com_venda
        FROM itens_venda iv
        JOIN produtos p ON p.id = iv.produto_id
        JOIN vendas v ON v.id = iv.venda_id
        GROUP BY p.id, p.nome
        ORDER BY total_vendido DESC
    `);
    return rows;
}

async function getParados() {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          MAX(v.data) AS ultima_venda
        FROM produtos p
        LEFT JOIN itens_venda iv ON iv.produto_id = p.id
        LEFT JOIN vendas v ON v.id = iv.venda_id
        GROUP BY p.id, p.nome
        HAVING MAX(v.data) IS NULL
           OR MAX(v.data) < NOW() - INTERVAL '30 days'
    `);
    return rows;
}

async function getPricingProfissional() {
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
        GROUP BY p.id, p.nome, p.custo, p.preco_venda
        ORDER BY total_vendido DESC
    `);
    return rows;
}

async function getLucroPorProduto() {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          COALESCE(SUM(iv.quantidade), 0) AS total_vendido,
          COALESCE(SUM(iv.quantidade * p.preco_venda), 0) AS faturamento,
          COALESCE(SUM(iv.quantidade * p.custo), 0) AS custo_total,
          COALESCE(SUM(iv.quantidade * (p.preco_venda - p.custo)), 0) AS lucro,
          ROUND(
            COALESCE(
              (SUM(iv.quantidade * (p.preco_venda - p.custo)) /
              NULLIF(SUM(iv.quantidade * p.preco_venda), 0)) * 100,
            0), 2
          ) AS margem_percentual
        FROM produtos p
        LEFT JOIN itens_venda iv ON iv.produto_id = p.id
        GROUP BY p.id, p.nome
        ORDER BY lucro DESC
    `);
    return rows;
}

async function getAlertaPrejuizo() {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          p.custo,
          p.preco_venda,
          (p.preco_venda - p.custo) AS lucro_unitario
        FROM produtos p
        WHERE (p.preco_venda - p.custo) <= 0
    `);
    return rows;
}

async function getMaisVendidos() {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          SUM(iv.quantidade) AS total_vendido,
          SUM(iv.quantidade * iv.preco_unitario) AS faturamento
        FROM itens_venda iv
        JOIN produtos p ON p.id = iv.produto_id
        GROUP BY p.id, p.nome
        ORDER BY total_vendido DESC
        LIMIT 10
    `);
    return rows;
}

async function getCurvaABC() {
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
        GROUP BY p.id, p.nome
    `);
    return rows;
}

async function getReposicao() {
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
        GROUP BY p.id, p.nome
    `);
    return rows;
}

async function getSugestaoPreco() {
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
        GROUP BY p.id, p.nome, p.custo, p.preco_venda
    `);
    return rows;
}

async function getInteligencia() {
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
        GROUP BY p.id, p.nome, p.custo, p.preco_venda
    `);
    return rows;
}

async function getAcoes() {
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
        GROUP BY p.id, p.nome
    `);
    return rows;
}

async function getDashboard() {
    const { rows } = await db.query(`
        SELECT
          COUNT(*) AS total_vendas,
          COALESCE(SUM(total), 0) AS faturamento,
          COALESCE(AVG(total), 0) AS ticket_medio
        FROM vendas
    `);
    return rows[0];
}

module.exports = {
    listar,
    criar,
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
    getDashboard
};
