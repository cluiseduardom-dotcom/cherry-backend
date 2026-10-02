const db = require('../config/db');
const AppError = require('../errors/AppError');

async function criar({ venda_id, empresa_id, forma_pagamento, valor, valor_recebido = 0, troco = 0, numero_parcelas = 1, status = 'pendente', origem = 'manual', provedor = null, transacao_externa_id = null, autorizacao = null, nsu = null, usuario_id, observacao = null }, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;

    try {
        if (gerenciaTransacao) await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO pagamentos_venda
             (venda_id, empresa_id, forma_pagamento, valor, valor_recebido, troco, numero_parcelas, status, origem, provedor, transacao_externa_id, autorizacao, nsu, usuario_id, observacao)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             RETURNING *`,
            [venda_id, empresa_id, forma_pagamento, valor, valor_recebido, troco, numero_parcelas, status, origem, provedor, transacao_externa_id, autorizacao, nsu, usuario_id, observacao]
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

async function listarPorVenda(venda_id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT * FROM pagamentos_venda WHERE venda_id = $1 AND empresa_id = $2 ORDER BY id`,
        [venda_id, empresa_id]
    );
    return rows;
}

async function buscarPorId(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT * FROM pagamentos_venda WHERE id = $1 AND empresa_id = $2`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function atualizarStatus(id, status, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE pagamentos_venda SET status = $1, atualizado_em = NOW()
         WHERE id = $2 AND empresa_id = $3 RETURNING *`,
        [status, id, empresa_id]
    );
    if (!rows.length) throw new AppError('Pagamento não encontrado', 404);
    return rows[0];
}

async function somarEstornos(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT COALESCE(SUM(valor), 0) AS total_estornado
         FROM estornos_pagamento WHERE pagamento_id = $1 AND empresa_id = $2`,
        [id, empresa_id]
    );
    return Number(rows[0].total_estornado);
}

module.exports = { criar, listarPorVenda, buscarPorId, atualizarStatus, somarEstornos };
