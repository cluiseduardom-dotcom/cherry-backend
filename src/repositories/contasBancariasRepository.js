const db = require('../config/db');

async function criar(dados) {
    const { rows } = await db.query(
        `INSERT INTO contas_bancarias
            (empresa_id, filial_id, nome, tipo, origem, banco_codigo,
             instituicao_nome, agencia, conta, digito, moeda, saldo_inicial,
             data_saldo_inicial, principal, status, provedor, conexao_externa_id,
             conta_externa_id, observacao, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING *`,
        [
            dados.empresa_id, dados.filial_id ?? null, dados.nome, dados.tipo,
            dados.origem ?? 'MANUAL', dados.banco_codigo ?? null,
            dados.instituicao_nome ?? null, dados.agencia ?? null,
            dados.conta ?? null, dados.digito ?? null, dados.moeda ?? 'BRL',
            dados.saldo_inicial ?? 0, dados.data_saldo_inicial ?? null,
            dados.principal ?? false, dados.status ?? 'ATIVA',
            dados.provedor ?? null, dados.conexao_externa_id ?? null,
            dados.conta_externa_id ?? null, dados.observacao ?? null,
            dados.usuario_id ?? null
        ]
    );
    return rows[0];
}

async function buscarPorId(id, empresaId) {
    const { rows } = await db.query(
        'SELECT * FROM contas_bancarias WHERE id = $1 AND empresa_id = $2',
        [id, empresaId]
    );
    return rows[0] || null;
}

async function listar(empresaId, filtros = {}) {
    const params = [empresaId];
    const where = ['empresa_id = $1'];

    if (filtros.status) {
        params.push(filtros.status);
        where.push(`status = $${params.length}`);
    }
    if (filtros.tipo) {
        params.push(filtros.tipo);
        where.push(`tipo = $${params.length}`);
    }
    if (filtros.filial_id != null) {
        params.push(filtros.filial_id);
        where.push(`filial_id = $${params.length}`);
    }

    const { rows } = await db.query(
        `SELECT * FROM contas_bancarias
         WHERE ${where.join(' AND ')}
         ORDER BY principal DESC, nome ASC`,
        params
    );
    return rows;
}

async function atualizarStatus(id, empresaId, status) {
    const { rows } = await db.query(
        `UPDATE contas_bancarias
            SET status = $1, updated_at = NOW()
          WHERE id = $2 AND empresa_id = $3
          RETURNING *`,
        [status, id, empresaId]
    );
    return rows[0] || null;
}

module.exports = { criar, buscarPorId, listar, atualizarStatus };
