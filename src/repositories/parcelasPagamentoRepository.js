const db = require('../config/db');
const AppError = require('../errors/AppError');

async function criar({ pagamento_id, empresa_id, numero, valor, valor_principal, juros = 0, desconto = 0, data_vencimento, status = 'pendente' }, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;
    try {
        if (gerenciaTransacao) await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO parcelas_pagamento
             (pagamento_id, empresa_id, numero, valor, valor_principal, juros, desconto, data_vencimento, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [pagamento_id, empresa_id, numero, valor, valor_principal, juros, desconto, data_vencimento, status]
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

async function criarLote(parcelas, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;
    try {
        if (gerenciaTransacao) await client.query('BEGIN');
        const result = [];
        for (const parcela of parcelas) result.push(await criar(parcela, client));
        if (gerenciaTransacao) await client.query('COMMIT');
        return result;
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
        `SELECT * FROM parcelas_pagamento WHERE pagamento_id = $1 AND empresa_id = $2 ORDER BY numero`,
        [pagamento_id, empresa_id]
    );
    return rows;
}

async function buscarPorId(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT * FROM parcelas_pagamento WHERE id = $1 AND empresa_id = $2`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function atualizarRecebimento(id, { valor_pago, status, data_pagamento, usuario_baixa_id }, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE parcelas_pagamento
         SET valor_pago = $1, status = $2, data_pagamento = $3, usuario_baixa_id = $4, atualizado_em = NOW()
         WHERE id = $5 AND empresa_id = $6 RETURNING *`,
        [valor_pago, status, data_pagamento, usuario_baixa_id, id, empresa_id]
    );
    if (!rows.length) throw new AppError('Parcela não encontrada', 404);
    return rows[0];
}

async function atualizarStatus(id, status, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE parcelas_pagamento SET status = $1, atualizado_em = NOW()
         WHERE id = $2 AND empresa_id = $3 RETURNING *`,
        [status, id, empresa_id]
    );
    if (!rows.length) throw new AppError('Parcela não encontrada', 404);
    return rows[0];
}

module.exports = { criar, criarLote, listarPorPagamento, buscarPorId, atualizarRecebimento, atualizarStatus };
