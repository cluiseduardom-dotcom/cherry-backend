const db = require('../config/db');

async function listar(empresa_id) {
    const { rows } = await db.query('SELECT * FROM clientes WHERE empresa_id = $1', [empresa_id]);
    return rows;
}

async function criar({ nome, telefone, email, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO clientes (nome, telefone, email, empresa_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, nome, telefone, email, empresa_id`,
        [nome, telefone, email, empresa_id]
    );

    return rows[0];
}

async function getHistorico(id, empresa_id) {
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
        WHERE v.cliente_id = $1 AND v.empresa_id = $2
        ORDER BY v.data DESC
    `, [id, empresa_id]);

    return rows;
}

async function getRanking(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          c.id,
          c.nome,
          COUNT(DISTINCT v.id) AS total_compras,
          COALESCE(SUM(v.total), 0) AS total_gasto,
          ROUND(COALESCE(AVG(v.total), 0), 2) AS ticket_medio
        FROM clientes c
        LEFT JOIN vendas v ON v.cliente_id = c.id AND v.empresa_id = c.empresa_id
        WHERE c.empresa_id = $1
        GROUP BY c.id, c.nome
        ORDER BY total_gasto DESC
    `, [empresa_id]);

    return rows;
}

async function getTotalGasto(id, empresa_id) {
    const { rows } = await db.query(`
        SELECT
          c.id,
          c.nome,
          COUNT(DISTINCT v.id) AS total_compras,
          COALESCE(SUM(v.total), 0) AS total_gasto,
          ROUND(COALESCE(AVG(v.total), 0), 2) AS ticket_medio
        FROM clientes c
        LEFT JOIN vendas v ON v.cliente_id = c.id AND v.empresa_id = c.empresa_id
        WHERE c.id = $1 AND c.empresa_id = $2
        GROUP BY c.id, c.nome
    `, [id, empresa_id]);

    return rows.length ? rows[0] : null;
}

module.exports = {
    listar,
    criar,
    getHistorico,
    getRanking,
    getTotalGasto
};
