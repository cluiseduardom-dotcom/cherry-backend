const db = require('../config/db');

async function listar() {
    const { rows } = await db.query('SELECT * FROM clientes');
    return rows;
}

async function criar({ nome, telefone, email }) {
    const { rows } = await db.query(
        `INSERT INTO clientes (nome, telefone, email)
         VALUES ($1, $2, $3)
         RETURNING id, nome, telefone, email`,
        [nome, telefone, email]
    );

    return rows[0];
}

async function getHistorico(id) {
    const { rows } = await db.query(`
        SELECT
          v.id AS venda_id,
          v.data,
          p.nome AS produto,
          iv.quantidade,
          iv.preco_unitario,
          (iv.quantidade * iv.preco_unitario) AS total_item
        FROM vendas v
        JOIN itens_venda iv ON iv.venda_id = v.id
        JOIN produtos p ON p.id = iv.produto_id
        WHERE v.cliente_id = $1
        ORDER BY v.data DESC
    `, [id]);

    return rows;
}

async function getRanking() {
    const { rows } = await db.query(`
        SELECT
          c.id,
          c.nome,
          COUNT(DISTINCT v.id) AS total_compras,
          COALESCE(SUM(v.total), 0) AS total_gasto,
          ROUND(COALESCE(AVG(v.total), 0), 2) AS ticket_medio
        FROM clientes c
        LEFT JOIN vendas v ON v.cliente_id = c.id
        GROUP BY c.id, c.nome
        ORDER BY total_gasto DESC
    `);

    return rows;
}

async function getTotalGasto(id) {
    const { rows } = await db.query(`
        SELECT
          c.id,
          c.nome,
          COUNT(DISTINCT v.id) AS total_compras,
          COALESCE(SUM(v.total), 0) AS total_gasto,
          ROUND(COALESCE(AVG(v.total), 0), 2) AS ticket_medio
        FROM clientes c
        LEFT JOIN vendas v ON v.cliente_id = c.id
        WHERE c.id = $1
        GROUP BY c.id, c.nome
    `, [id]);

    return rows.length ? rows[0] : null;
}

module.exports = {
    listar,
    criar,
    getHistorico,
    getRanking,
    getTotalGasto
};
