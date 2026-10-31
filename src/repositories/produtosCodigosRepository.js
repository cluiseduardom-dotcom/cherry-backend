const db = require('../config/db');

async function listarPorProduto(produtoId, empresaId) {
    const { rows } = await db.query(
        `SELECT * FROM produtos_codigos
         WHERE produto_id = $1 AND empresa_id = $2
         ORDER BY principal DESC, id ASC`,
        [produtoId, empresaId]
    );
    return rows;
}

async function buscarPorCodigo(codigo, empresaId) {
    const { rows } = await db.query(
        `SELECT pc.*, p.nome, p.sku, p.ativo AS produto_ativo
         FROM produtos_codigos pc
         JOIN produtos p ON p.id = pc.produto_id AND p.empresa_id = pc.empresa_id
         WHERE pc.empresa_id = $1 AND pc.codigo = $2 AND pc.ativo = true
         LIMIT 1`,
        [empresaId, codigo]
    );
    return rows.length ? rows[0] : null;
}

async function criar({ empresaId, produtoId, codigo, tipo, principal, descricao, usuarioId }) {
    if (principal) {
        await db.query(
            'UPDATE produtos_codigos SET principal = false, atualizado_em = NOW() WHERE empresa_id = $1 AND produto_id = $2 AND ativo = true',
            [empresaId, produtoId]
        );
    }

    const { rows } = await db.query(
        `INSERT INTO produtos_codigos
         (empresa_id, produto_id, codigo, tipo, principal, descricao, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [empresaId, produtoId, codigo, tipo, principal ?? false, descricao ?? null, usuarioId ?? null]
    );
    return rows[0];
}

async function desativar(id, empresaId) {
    const { rows } = await db.query(
        `UPDATE produtos_codigos
         SET ativo = false, principal = false, atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2
         RETURNING *`,
        [id, empresaId]
    );
    return rows.length ? rows[0] : null;
}

// Produtos da empresa entre os ids pedidos (isolamento: ids de outra empresa simplesmente não voltam).
async function idsDeProdutosDaEmpresa(produtoIds, empresaId) {
    const { rows } = await db.query(
        'SELECT id FROM produtos WHERE empresa_id = $1 AND id = ANY($2::int[])',
        [empresaId, produtoIds]
    );
    return rows.map((r) => r.id);
}

// Códigos ativos dos produtos, o principal primeiro (o de cada produto que serve para a etiqueta).
async function listarAtivosDeProdutos(produtoIds, empresaId) {
    const { rows } = await db.query(
        `SELECT produto_id, codigo, tipo, principal FROM produtos_codigos
         WHERE empresa_id = $1 AND produto_id = ANY($2::int[]) AND ativo = true
         ORDER BY produto_id, principal DESC, id ASC`,
        [empresaId, produtoIds]
    );
    return rows;
}

module.exports = { listarPorProduto, buscarPorCodigo, criar, desativar, idsDeProdutosDaEmpresa, listarAtivosDeProdutos };
