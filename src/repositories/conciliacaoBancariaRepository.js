const db = require('../config/db');

async function criar(dados) {
    const { rows } = await db.query(
        `INSERT INTO conciliacoes_bancarias
            (empresa_id, movimento_bancario_id, tipo, status, referencia_externa, valor_externo,
             data_externa, descricao_externa, usuario_id, observacao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [dados.empresa_id, dados.movimento_bancario_id, dados.tipo ?? 'MANUAL',
         dados.status ?? 'CONCILIADA', dados.referencia_externa ?? null, dados.valor_externo ?? null,
         dados.data_externa ?? null, dados.descricao_externa ?? null, dados.usuario_id ?? null,
         dados.observacao ?? null]
    );
    return rows[0];
}

async function buscarPorMovimento(id, empresaId) {
    const { rows } = await db.query(
        `SELECT * FROM conciliacoes_bancarias
          WHERE movimento_bancario_id = $1 AND empresa_id = $2
          ORDER BY id DESC LIMIT 1`,
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
    const { rows } = await db.query(
        `SELECT * FROM conciliacoes_bancarias WHERE ${where.join(' AND ')}
          ORDER BY conciliada_em DESC, id DESC`,
        params
    );
    return rows;
}

async function buscarPorId(id, empresaId) {
    const { rows } = await db.query(
        'SELECT * FROM conciliacoes_bancarias WHERE id = $1 AND empresa_id = $2',
        [id, empresaId]
    );
    return rows[0] || null;
}

// Concilia numa só instrução: o movimento só é marcado se ainda não estava conciliado nem cancelado, e a
// conciliação só nasce junto. Duas chamadas simultâneas: uma vence, a outra recebe null.
async function conciliarAtomico(dados) {
    const { rows } = await db.query(
        `WITH alvo AS (
             UPDATE movimentos_bancarios
                SET conciliado = TRUE, updated_at = NOW()
              WHERE id = $2 AND empresa_id = $1 AND conciliado = FALSE AND cancelado_em IS NULL
              RETURNING id
         )
         INSERT INTO conciliacoes_bancarias
            (empresa_id, movimento_bancario_id, tipo, status, referencia_externa, valor_externo,
             data_externa, descricao_externa, usuario_id, observacao)
         SELECT $1, alvo.id, $3, 'CONCILIADA', $4, $5, $6, $7, $8, $9 FROM alvo
         RETURNING *`,
        [dados.empresa_id, dados.movimento_bancario_id, dados.tipo ?? 'MANUAL',
         dados.referencia_externa ?? null, dados.valor_externo ?? null, dados.data_externa ?? null,
         dados.descricao_externa ?? null, dados.usuario_id ?? null, dados.observacao ?? null]
    );
    return rows[0] || null;
}

// Desfaz a conciliação ativa e devolve o movimento para "não conciliado", também numa só instrução.
async function desfazerAtomico(id, empresaId) {
    const { rows } = await db.query(
        `WITH d AS (
             UPDATE conciliacoes_bancarias
                SET status = 'DESFEITA', updated_at = NOW()
              WHERE id = $1 AND empresa_id = $2 AND status = 'CONCILIADA'
              RETURNING *
         ), m AS (
             UPDATE movimentos_bancarios mv
                SET conciliado = FALSE, updated_at = NOW()
               FROM d
              WHERE mv.id = d.movimento_bancario_id AND mv.empresa_id = $2
              RETURNING mv.id
         )
         SELECT d.* FROM d`,
        [id, empresaId]
    );
    return rows[0] || null;
}

module.exports = { criar, buscarPorMovimento, listar, buscarPorId, conciliarAtomico, desfazerAtomico };
