const db = require('../config/db');

// clienteExterno permite participar de uma transação já aberta por outro módulo
// (ex: criação de venda, que precisa que a baixa de estoque de todos os itens e o
// registro da venda sejam a mesma transação). Quando informado, esta função não
// abre/fecha transação nem libera a conexão — quem chamou é responsável por isso.
async function criarMovimentacao({ produto_id, tipo, quantidade, motivo, usuario_id, empresa_id }, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;

    try {
        if (gerenciaTransacao) await client.query('BEGIN');

        const { rows: produtoRows } = await client.query(
            'SELECT id, estoque_atual FROM produtos WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
            [produto_id, empresa_id]
        );

        if (!produtoRows.length) {
            if (gerenciaTransacao) await client.query('ROLLBACK');
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
            if (gerenciaTransacao) await client.query('ROLLBACK');
            return { erro: 'ESTOQUE_INSUFICIENTE' };
        }

        await client.query('UPDATE produtos SET estoque_atual = $1 WHERE id = $2', [novoEstoque, produto_id]);

        const { rows } = await client.query(
            `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, estoque_resultante, motivo, usuario_id, empresa_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [produto_id, tipo, quantidade, novoEstoque, motivo ?? null, usuario_id, empresa_id]
        );

        if (gerenciaTransacao) await client.query('COMMIT');

        return { movimentacao: rows[0] };

    } catch (error) {
        if (gerenciaTransacao) await client.query('ROLLBACK');
        throw error;
    } finally {
        if (gerenciaTransacao) client.release();
    }
}

async function listarPorProduto(produto_id, empresa_id, { limit, offset }) {
    const { rows } = await db.query(
        `SELECT * FROM movimentacoes_estoque
         WHERE produto_id = $1 AND empresa_id = $2
         ORDER BY criado_em DESC, id DESC
         LIMIT $3 OFFSET $4`,
        [produto_id, empresa_id, limit, offset]
    );

    const { rows: countRows } = await db.query(
        'SELECT COUNT(*) FROM movimentacoes_estoque WHERE produto_id = $1 AND empresa_id = $2',
        [produto_id, empresa_id]
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function getEstoqueBaixo(empresa_id) {
    const { rows } = await db.query(`
        SELECT id, sku, nome, categoria, estoque_atual, estoque_minimo
        FROM produtos
        WHERE ativo = true
          AND estoque_atual <= estoque_minimo
          AND empresa_id = $1
        ORDER BY (estoque_atual - estoque_minimo) ASC
    `, [empresa_id]);

    return rows;
}

module.exports = {
    criarMovimentacao,
    listarPorProduto,
    getEstoqueBaixo
};
