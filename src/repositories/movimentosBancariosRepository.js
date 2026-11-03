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

// Lançamento idempotente (automático/importado): se a mesma referência já existe nesta conta e origem,
// não duplica e devolve { criado: false }. Nunca sobrescreve o que já existe.
async function criarSeNovo(dados, client = db) {
    const { rows } = await client.query(
        `INSERT INTO movimentos_bancarios
            (empresa_id, conta_bancaria_id, tipo, origem, valor, data_movimento,
             descricao, referencia_externa, observacao, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (empresa_id, conta_bancaria_id, origem, referencia_externa)
            WHERE referencia_externa IS NOT NULL
         DO NOTHING
         RETURNING *`,
        [
            dados.empresa_id, dados.conta_bancaria_id, dados.tipo, dados.origem, dados.valor,
            dados.data_movimento ?? new Date(), dados.descricao ?? null,
            dados.referencia_externa, dados.observacao ?? null, dados.usuario_id ?? null
        ]
    );
    return rows[0] ? { criado: true, movimento: rows[0] } : { criado: false, movimento: null };
}

async function buscarPorId(id, empresaId) {
    const { rows } = await db.query(
        'SELECT * FROM movimentos_bancarios WHERE id=$1 AND empresa_id=$2',
        [id, empresaId]
    );
    return rows[0] || null;
}

const MAX_POR_PAGINA = 200;

async function listar(empresaId, filtros = {}) {
    const params = [empresaId];
    const where = ['m.empresa_id = $1'];
    if (filtros.conta_bancaria_id != null) {
        params.push(filtros.conta_bancaria_id);
        where.push(`m.conta_bancaria_id = $${params.length}`);
    }
    if (filtros.tipo) {
        params.push(filtros.tipo);
        where.push(`m.tipo = $${params.length}`);
    }
    if (filtros.conciliado !== undefined) {
        params.push(filtros.conciliado);
        where.push(`m.conciliado = $${params.length}`);
    }
    if (filtros.data_inicio) {
        params.push(filtros.data_inicio);
        where.push(`(m.data_movimento AT TIME ZONE 'America/Sao_Paulo')::date >= $${params.length}`);
    }
    if (filtros.data_fim) {
        params.push(filtros.data_fim);
        where.push(`(m.data_movimento AT TIME ZONE 'America/Sao_Paulo')::date <= $${params.length}`);
    }
    if (!filtros.incluir_cancelados) {
        where.push('m.cancelado_em IS NULL');
    }

    const limite = Math.min(Number(filtros.limit) || 50, MAX_POR_PAGINA);
    const deslocamento = Math.max(Number(filtros.offset) || 0, 0);

    const { rows: total } = await db.query(
        `SELECT COUNT(*)::int AS total FROM movimentos_bancarios m WHERE ${where.join(' AND ')}`,
        params
    );

    params.push(limite, deslocamento);
    const { rows } = await db.query(
        `SELECT m.*, c.nome AS conta_nome, cb.id AS conciliacao_id
           FROM movimentos_bancarios m
           JOIN contas_bancarias c ON c.id = m.conta_bancaria_id AND c.empresa_id = m.empresa_id
           LEFT JOIN conciliacoes_bancarias cb ON cb.movimento_bancario_id = m.id AND cb.empresa_id = m.empresa_id
                                              AND cb.status = 'CONCILIADA'
          WHERE ${where.join(' AND ')}
          ORDER BY m.data_movimento DESC, m.id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
    );
    return { items: rows, total: total[0].total };
}

async function marcarConciliado(id, empresaId) {
    const { rows } = await db.query(
        `UPDATE movimentos_bancarios
            SET conciliado = TRUE, updated_at = NOW()
          WHERE id = $1 AND empresa_id = $2 RETURNING *`,
        [id, empresaId]
    );
    return rows[0] || null;
}

// Cancelamento: nada é apagado. Recusa o que já foi conciliado (desfaça a conciliação antes) e o que já
// está cancelado. A condição vai no próprio UPDATE, então duas chamadas simultâneas não cancelam duas vezes.
async function cancelar(id, empresaId, usuarioId, motivo) {
    const { rows } = await db.query(
        `UPDATE movimentos_bancarios
            SET cancelado_em = NOW(), cancelado_por = $3, motivo_cancelamento = $4, updated_at = NOW()
          WHERE id = $1 AND empresa_id = $2 AND cancelado_em IS NULL AND conciliado = FALSE
          RETURNING *`,
        [id, empresaId, usuarioId ?? null, motivo]
    );
    return rows[0] || null;
}

module.exports = { criar, criarSeNovo, buscarPorId, listar, marcarConciliado, cancelar };
