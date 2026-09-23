const db = require('../config/db');

async function criar({ pagamento_id, empresa_id, valor, motivo, usuario_id }, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;
    try {
        if (gerenciaTransacao) await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO estornos_pagamento (pagamento_id, empresa_id, valor, motivo, usuario_id)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [pagamento_id, empresa_id, valor, motivo, usuario_id]
        );
        if (gerenciaTransacao) await client.query('COMMIT');
        return rows[0];
    } catch (error) {
        if (gerenciaTransacao) await client.query('ROLLBACK');
        throw error;
    } finally {
        if (gerenciaTransacao) client.release();
    }
}

async function listarPorPagamento(pagamento_id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT * FROM estornos_pagamento WHERE pagamento_id = $1 AND empresa_id = $2 ORDER BY criado_em, id`,
        [pagamento_id, empresa_id]
    );
    return rows;
}

module.exports = { criar, listarPorPagamento };
