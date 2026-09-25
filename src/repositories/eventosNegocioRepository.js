const db = require('../config/db');

async function criar({
    empresa_id,
    filial_id = null,
    tipo_evento,
    entidade_tipo,
    entidade_id,
    payload = {},
    usuario_id = null
}, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO eventos_negocio
            (empresa_id, filial_id, tipo_evento, entidade_tipo, entidade_id, payload, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING *`,
        [empresa_id, filial_id, tipo_evento, entidade_tipo, entidade_id, JSON.stringify(payload), usuario_id]
    );
    return rows[0];
}

async function buscarPorId(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM eventos_negocio WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function listarPendentes(empresa_id, limite = 50, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT * FROM eventos_negocio
         WHERE empresa_id = $1 AND status = 'PENDENTE'
         ORDER BY ocorrido_em ASC, id ASC
         LIMIT $2`,
        [empresa_id, limite]
    );
    return rows;
}

async function marcarProcessando(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE eventos_negocio
         SET status = 'PROCESSANDO', tentativas = tentativas + 1, updated_at = NOW()
         WHERE id = $1 AND empresa_id = $2 AND status = 'PENDENTE'
         RETURNING *`,
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function marcarProcessado(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE eventos_negocio
         SET status = 'PROCESSADO', processado_em = NOW(), erro = NULL, updated_at = NOW()
         WHERE id = $1 AND empresa_id = $2
         RETURNING *`,
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function marcarErro(id, empresa_id, erro, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE eventos_negocio
         SET status = 'ERRO', erro = $3, updated_at = NOW()
         WHERE id = $1 AND empresa_id = $2
         RETURNING *`,
        [id, empresa_id, String(erro || 'Erro desconhecido')]
    );
    return rows[0] || null;
}

module.exports = {
    criar,
    buscarPorId,
    listarPendentes,
    marcarProcessando,
    marcarProcessado,
    marcarErro
};
