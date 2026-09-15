const db = require('../config/db');

async function listar(empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM niveis_categoria WHERE empresa_id = $1 ORDER BY nivel ASC`,
        [empresa_id]
    );
    return rows;
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM niveis_categoria WHERE id = $1 AND empresa_id = $2`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function buscarPorNivel(nivel, empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM niveis_categoria WHERE nivel = $1 AND empresa_id = $2`,
        [nivel, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function criar({ nivel, nome, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO niveis_categoria (nivel, nome, empresa_id) VALUES ($1, $2, $3) RETURNING *`,
        [nivel, nome, empresa_id]
    );
    return rows[0];
}

async function atualizarNome(id, nome, empresa_id) {
    const { rows } = await db.query(
        `UPDATE niveis_categoria SET nome = $1, atualizado_em = NOW()
         WHERE id = $2 AND empresa_id = $3
         RETURNING *`,
        [nome, id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function remover(id, empresa_id) {
    const { rows } = await db.query(
        `DELETE FROM niveis_categoria WHERE id = $1 AND empresa_id = $2 RETURNING *`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

module.exports = { listar, buscarPorId, buscarPorNivel, criar, atualizarNome, remover };
