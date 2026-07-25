const db = require('../config/db');

async function listarCanais() {
    const { rows } = await db.query('SELECT * FROM canais_venda ORDER BY id');
    return rows;
}

async function buscarCanalPorId(id) {
    const { rows } = await db.query('SELECT * FROM canais_venda WHERE id = $1', [id]);
    return rows.length ? rows[0] : null;
}

async function buscarCanalPorNome(nome) {
    const { rows } = await db.query('SELECT * FROM canais_venda WHERE nome = $1', [nome]);
    return rows.length ? rows[0] : null;
}

async function buscarPrecoVigente(produto_id, canal_id) {
    const { rows } = await db.query(
        `SELECT * FROM precos_produto
         WHERE produto_id = $1 AND canal_id = $2
         ORDER BY criado_em DESC, id DESC
         LIMIT 1`,
        [produto_id, canal_id]
    );

    return rows.length ? rows[0] : null;
}

async function listarPrecosVigentesPorProduto(produto_id) {
    const { rows } = await db.query(
        `SELECT c.id AS canal_id, c.nome AS canal, latest.preco_venda, latest.markup_percentual,
                latest.margem_percentual, latest.vigente_desde
         FROM canais_venda c
         LEFT JOIN LATERAL (
             SELECT preco_venda, markup_percentual, margem_percentual, vigente_desde
             FROM precos_produto
             WHERE produto_id = $1 AND canal_id = c.id
             ORDER BY criado_em DESC, id DESC
             LIMIT 1
         ) latest ON true
         WHERE c.ativo = true
         ORDER BY c.id`,
        [produto_id]
    );

    return rows;
}

async function listarPrecosVigentesPorCanal(produtoIds, canal_id) {
    if (!produtoIds.length) return [];

    const { rows } = await db.query(
        `SELECT p.produto_id, latest.preco_venda, latest.markup_percentual,
                latest.margem_percentual, latest.vigente_desde
         FROM unnest($1::int[]) AS p(produto_id)
         LEFT JOIN LATERAL (
             SELECT preco_venda, markup_percentual, margem_percentual, vigente_desde
             FROM precos_produto
             WHERE produto_id = p.produto_id AND canal_id = $2
             ORDER BY criado_em DESC, id DESC
             LIMIT 1
         ) latest ON true`,
        [produtoIds, canal_id]
    );

    return rows;
}

async function listarMargemPorProdutoECanal() {
    const { rows } = await db.query(
        `SELECT p.id AS produto_id, p.nome, p.custo, c.id AS canal_id, c.nome AS canal,
                latest.preco_venda, latest.margem_percentual, latest.vigente_desde
         FROM produtos p
         CROSS JOIN canais_venda c
         LEFT JOIN LATERAL (
             SELECT preco_venda, margem_percentual, vigente_desde
             FROM precos_produto
             WHERE produto_id = p.id AND canal_id = c.id
             ORDER BY criado_em DESC, id DESC
             LIMIT 1
         ) latest ON true
         WHERE p.ativo = true AND c.ativo = true
         ORDER BY p.id, c.id`
    );

    return rows;
}

async function inserirPreco({ produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, usuario_id }) {
    const { rows } = await db.query(
        `INSERT INTO precos_produto (produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, usuario_id ?? null]
    );

    return rows[0];
}

async function listarHistoricoPorProduto(produto_id, canal_id, { limit, offset }) {
    const condicoes = ['produto_id = $1'];
    const valores = [produto_id];

    if (canal_id !== undefined) {
        valores.push(canal_id);
        condicoes.push(`canal_id = $${valores.length}`);
    }

    const where = condicoes.join(' AND ');

    valores.push(limit, offset);
    const { rows } = await db.query(
        `SELECT * FROM precos_produto
         WHERE ${where}
         ORDER BY criado_em DESC, id DESC
         LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
        valores
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM precos_produto WHERE ${where}`,
        valores.slice(0, canal_id !== undefined ? 2 : 1)
    );

    return { items: rows, total: Number(countRows[0].count) };
}

module.exports = {
    listarCanais,
    buscarCanalPorId,
    buscarCanalPorNome,
    buscarPrecoVigente,
    listarPrecosVigentesPorProduto,
    listarPrecosVigentesPorCanal,
    listarMargemPorProdutoECanal,
    inserirPreco,
    listarHistoricoPorProduto
};
