const db = require('../config/db');

async function listarPaginado({ limit, offset, empresa_id }) {
    const { rows } = await db.query(
        `SELECT * FROM categorias_produto
         WHERE empresa_id = $1 AND deletado_em IS NULL
         ORDER BY nivel ASC, codigo ASC
         LIMIT $2 OFFSET $3`,
        [empresa_id, limit, offset]
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM categorias_produto WHERE empresa_id = $1 AND deletado_em IS NULL`,
        [empresa_id]
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM categorias_produto WHERE id = $1 AND empresa_id = $2 AND deletado_em IS NULL`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function buscarPorCodigoNivel(nivel, codigo, empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM categorias_produto
         WHERE nivel = $1 AND UPPER(codigo) = $2 AND empresa_id = $3 AND deletado_em IS NULL`,
        [nivel, codigo, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function buscarPorIds(ids, empresa_id) {
    if (!ids.length) return [];

    const { rows } = await db.query(
        `SELECT * FROM categorias_produto WHERE id = ANY($1::int[]) AND empresa_id = $2 AND deletado_em IS NULL`,
        [ids, empresa_id]
    );
    return rows;
}

async function criar({ nivel, codigo, nome, configuracao_sku_id, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO categorias_produto (nivel, codigo, nome, configuracao_sku_id, empresa_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [nivel, codigo, nome, configuracao_sku_id ?? null, empresa_id]
    );
    return rows[0];
}

async function atualizar(id, { nome, configuracao_sku_id }, empresa_id) {
    const { rows } = await db.query(
        `UPDATE categorias_produto
         SET nome = $1,
             configuracao_sku_id = $2,
             atualizado_em = NOW()
         WHERE id = $3 AND empresa_id = $4 AND deletado_em IS NULL
         RETURNING *`,
        [nome, configuracao_sku_id ?? null, id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function softDelete(id, empresa_id) {
    const { rows } = await db.query(
        `UPDATE categorias_produto SET deletado_em = NOW(), atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND deletado_em IS NULL
         RETURNING *`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

module.exports = {
    listarPaginado,
    buscarPorId,
    buscarPorCodigoNivel,
    buscarPorIds,
    criar,
    atualizar,
    softDelete
};
