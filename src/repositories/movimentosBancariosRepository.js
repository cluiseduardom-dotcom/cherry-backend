const db = require('../config/db');

async function criar(dados) {
    const { rows } = await db.query(
        `INSERT INTO movimentos_bancarios
            (empresa_id, conta_bancaria_id, tipo, origem, valor, data_movimento,
             descricao, referencia_externa, liquidacao_pagamento_id,
             transacao_pagamento_id, conciliado, observacao, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
            dados.empresa_id, dados.conta_bancaria_id, dados.tipo,
            dados.origem ?? 'MANUAL', dados.valor,
            dados.data_movimento ?? new Date(), dados.descricao ?? null,
            dados.referencia_externa ?? null, dados.liquidacao_pagamento_id ?? null,
            dados.transacao_pagamento_id ?? null, dados.conciliado ?? false,
            dados.observacao ?? null, dados.usuario_id ?? null
        ]
    );
    return rows[0];
}

async function buscarPorId(id, empresaId) {
    const { rows } = await db.query(
        'SELECT * FROM movimentos_bancarios WHERE id=$1 AND empresa_id=$2',
        [id, empresaId]
    );
    return rows[0] || null;
}

async function listar(empresaId, filtros = {}) {
    const params=[empresaId];
    const where=['empresa_id=$1'];
    if (filtros.conta_bancaria_id != null) {
        params.push(filtros.conta_bancaria_id);
        where.push(`conta_bancaria_id=$${params.length}`);
    }
    if (filtros.tipo) {
        params.push(filtros.tipo);
        where.push(`tipo=$${params.length}`);
    }
    if (filtros.conciliado !== undefined) {
        params.push(filtros.conciliado);
        where.push(`conciliado=$${params.length}`);
    }
    const { rows }=await db.query(
        `SELECT * FROM movimentos_bancarios
         WHERE ${where.join(' AND ')}
         ORDER BY data_movimento DESC,id DESC`,params);
    return rows;
}

async function marcarConciliado(id, empresaId) {
    const { rows }=await db.query(
        `UPDATE movimentos_bancarios
            SET conciliado=TRUE,updated_at=NOW()
          WHERE id=$1 AND empresa_id=$2 RETURNING *`,
        [id,empresaId]);
    return rows[0] || null;
}

module.exports={criar,buscarPorId,listar,marcarConciliado};
