const db = require('../config/db');

async function criar({ parcela_id, empresa_id, valor, forma_pagamento, usuario_id, data_recebimento, observacao = null, chave_idempotencia = null }, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;
    try {
        if (gerenciaTransacao) await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO recebimentos_conta
             (parcela_id, empresa_id, valor, forma_pagamento, usuario_id, data_recebimento, observacao, chave_idempotencia)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [parcela_id, empresa_id, valor, forma_pagamento, usuario_id, data_recebimento, observacao, chave_idempotencia]
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

// Recebimento já registrado com esta chave (idempotência). Dentro da transação, com a parcela travada.
async function buscarPorChave(empresa_id, chave, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM recebimentos_conta WHERE empresa_id = $1 AND chave_idempotencia = $2',
        [empresa_id, chave]
    );
    return rows[0] ?? null;
}

async function listarPorParcela(parcela_id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT * FROM recebimentos_conta WHERE parcela_id = $1 AND empresa_id = $2 ORDER BY data_recebimento, id`,
        [parcela_id, empresa_id]
    );
    return rows;
}

async function somarPorParcela(parcela_id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT COALESCE(SUM(valor), 0) AS total_recebido
         FROM recebimentos_conta WHERE parcela_id = $1 AND empresa_id = $2`,
        [parcela_id, empresa_id]
    );
    return Number(rows[0].total_recebido);
}

module.exports = { criar, buscarPorChave, listarPorParcela, somarPorParcela };
