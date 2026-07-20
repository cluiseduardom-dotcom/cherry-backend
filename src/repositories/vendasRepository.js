const db = require('../config/db');

async function getResumo() {
    const { rows } = await db.query(`
        SELECT
          COUNT(*) AS total_vendas,
          COALESCE(SUM(total), 0) AS faturamento,
          COALESCE(AVG(total), 0) AS ticket_medio
        FROM vendas
    `);
    return rows[0];
}

async function getPorDia() {
    const { rows } = await db.query(`
        SELECT
          DATE(data) AS dia,
          COALESCE(SUM(total), 0) AS faturamento,
          COUNT(*) AS total_vendas
        FROM vendas
        GROUP BY DATE(data)
        ORDER BY dia DESC
    `);
    return rows;
}

async function getPorMes() {
    const { rows } = await db.query(`
        SELECT
          TO_CHAR(data, 'YYYY-MM') AS mes,
          COALESCE(SUM(total), 0) AS faturamento,
          COUNT(*) AS total_vendas
        FROM vendas
        GROUP BY mes
        ORDER BY mes DESC
    `);
    return rows;
}

async function getMaisVendidosPeriodo() {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          COALESCE(SUM(iv.quantidade), 0) AS total_vendido
        FROM itens_venda iv
        JOIN produtos p ON p.id = iv.produto_id
        GROUP BY p.id, p.nome
        ORDER BY total_vendido DESC
        LIMIT 10
    `);
    return rows;
}

async function criar({ cliente_id, itens, total }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const vendaResult = await client.query(
            `INSERT INTO vendas (cliente_id, total, data)
             VALUES ($1, $2, NOW())
             RETURNING id, cliente_id, total, data`,
            [cliente_id, total]
        );

        const venda = vendaResult.rows[0];

        const valores = itens.map(item => [venda.id, item.produto_id, item.quantidade, item.preco_unitario]);

        const placeholders = valores
            .map((_, i) => {
                const base = i * 4;
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
            })
            .join(', ');

        await client.query(
            `INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario)
             VALUES ${placeholders}`,
            valores.flat()
        );

        await client.query('COMMIT');

        return venda;

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    getResumo,
    getPorDia,
    getPorMes,
    getMaisVendidosPeriodo,
    criar
};
