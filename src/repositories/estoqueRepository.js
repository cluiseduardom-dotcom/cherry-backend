const db = require('../config/db');

async function criarMovimentacao({ produto_id, tipo, quantidade, motivo, usuario_id }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: produtoRows } = await client.query(
            'SELECT id, estoque_atual FROM produtos WHERE id = $1 FOR UPDATE',
            [produto_id]
        );

        if (!produtoRows.length) {
            await client.query('ROLLBACK');
            return { erro: 'PRODUTO_NAO_ENCONTRADO' };
        }

        const estoqueAtual = produtoRows[0].estoque_atual;
        let novoEstoque;

        if (tipo === 'entrada') {
            novoEstoque = estoqueAtual + quantidade;
        } else if (tipo === 'saida') {
            novoEstoque = estoqueAtual - quantidade;
        } else {
            novoEstoque = quantidade;
        }

        if (novoEstoque < 0) {
            await client.query('ROLLBACK');
            return { erro: 'ESTOQUE_INSUFICIENTE' };
        }

        await client.query('UPDATE produtos SET estoque_atual = $1 WHERE id = $2', [novoEstoque, produto_id]);

        const { rows } = await client.query(
            `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, estoque_resultante, motivo, usuario_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [produto_id, tipo, quantidade, novoEstoque, motivo ?? null, usuario_id]
        );

        await client.query('COMMIT');

        return { movimentacao: rows[0] };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function listarPorProduto(produto_id, { limit, offset }) {
    const { rows } = await db.query(
        `SELECT * FROM movimentacoes_estoque
         WHERE produto_id = $1
         ORDER BY criado_em DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [produto_id, limit, offset]
    );

    const { rows: countRows } = await db.query(
        'SELECT COUNT(*) FROM movimentacoes_estoque WHERE produto_id = $1',
        [produto_id]
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function getEstoqueBaixo() {
    const { rows } = await db.query(`
        SELECT id, sku, nome, categoria, estoque_atual, estoque_minimo
        FROM produtos
        WHERE ativo = true
          AND estoque_atual <= estoque_minimo
        ORDER BY (estoque_atual - estoque_minimo) ASC
    `);

    return rows;
}

module.exports = {
    criarMovimentacao,
    listarPorProduto,
    getEstoqueBaixo
};
