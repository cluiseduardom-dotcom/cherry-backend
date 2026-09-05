const db = require('../config/db');
const AppError = require('../errors/AppError');

function montarResposta(ficha, itensRows) {
    let custo_sugerido = 0;

    const itens = itensRows.map((item) => {
        const custo_unitario = Number(item.custo_unitario);
        const quantidade_necessaria = Number(item.quantidade_necessaria);
        const subtotal_custo = Number((quantidade_necessaria * custo_unitario).toFixed(2));
        custo_sugerido += subtotal_custo;

        return {
            id: item.id,
            insumo_produto_id: item.insumo_produto_id,
            insumo_nome: item.insumo_nome,
            quantidade_necessaria,
            custo_unitario,
            subtotal_custo
        };
    });

    return { ...ficha, itens, custo_sugerido: Number(custo_sugerido.toFixed(2)) };
}

// Uma única transação: valida produto (tipo 'acabado') e cada insumo (tipo
// 'insumo'), ambos da mesma empresa — 404 se não existir/empresa errada
// (mesmo padrão do resto do projeto), 400 se existir mas o tipo estiver
// errado (mesmo padrão de "produto inativo" em compras/estoque). Nunca faz
// UPDATE pra "editar" uma ficha: deriva a antiga (vigente = false) e insere
// a nova (vigente = true) na mesma transação, NESSA ORDEM — inserir a nova
// antes de derrubar a antiga violaria o índice único parcial mesmo que só
// por um instante.
async function criarVersao({ produto_id, itens, usuario_id, empresa_id }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: produtoRows } = await client.query(
            'SELECT id, tipo FROM produtos WHERE id = $1 AND empresa_id = $2',
            [produto_id, empresa_id]
        );

        if (!produtoRows.length) {
            throw new AppError('Produto não encontrado', 404);
        }

        if (produtoRows[0].tipo !== 'acabado') {
            throw new AppError("Produto deve ser do tipo 'acabado' para ter ficha técnica", 400);
        }

        const insumosValidados = [];

        for (const item of itens) {
            const { rows: insumoRows } = await client.query(
                'SELECT id, tipo, custo FROM produtos WHERE id = $1 AND empresa_id = $2',
                [item.insumo_produto_id, empresa_id]
            );

            if (!insumoRows.length) {
                throw new AppError('Insumo não encontrado', 404);
            }

            if (insumoRows[0].tipo !== 'insumo') {
                throw new AppError(`Produto ${item.insumo_produto_id} deve ser do tipo 'insumo'`, 400);
            }

            insumosValidados.push({
                insumo_produto_id: item.insumo_produto_id,
                quantidade_necessaria: item.quantidade_necessaria,
                custo: Number(insumoRows[0].custo)
            });
        }

        await client.query(
            'UPDATE fichas_tecnicas SET vigente = false WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true',
            [produto_id, empresa_id]
        );

        const { rows: fichaRows } = await client.query(
            `INSERT INTO fichas_tecnicas (empresa_id, produto_id, vigente, criado_por)
             VALUES ($1, $2, true, $3)
             RETURNING *`,
            [empresa_id, produto_id, usuario_id]
        );

        const ficha = fichaRows[0];

        const valores = insumosValidados.map((item) => [ficha.id, item.insumo_produto_id, item.quantidade_necessaria, empresa_id]);
        const placeholders = valores
            .map((_, i) => {
                const base = i * 4;
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
            })
            .join(', ');

        const { rows: itensRows } = await client.query(
            `INSERT INTO itens_ficha_tecnica (ficha_tecnica_id, insumo_produto_id, quantidade_necessaria, empresa_id)
             VALUES ${placeholders}
             RETURNING id, insumo_produto_id, quantidade_necessaria`,
            valores.flat()
        );

        await client.query('COMMIT');

        const itensComCusto = itensRows.map((row) => {
            const validado = insumosValidados.find((v) => v.insumo_produto_id === row.insumo_produto_id);
            return { ...row, custo_unitario: validado.custo };
        });

        return montarResposta(ficha, itensComCusto);

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function buscarVigentePorProduto(produto_id, empresa_id) {
    const { rows } = await db.query(
        'SELECT * FROM fichas_tecnicas WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true',
        [produto_id, empresa_id]
    );

    if (!rows.length) return null;

    const ficha = rows[0];

    const { rows: itensRows } = await db.query(
        `SELECT itf.id, itf.insumo_produto_id, itf.quantidade_necessaria, p.custo AS custo_unitario, p.nome AS insumo_nome
         FROM itens_ficha_tecnica itf
         JOIN produtos p ON p.id = itf.insumo_produto_id
         WHERE itf.ficha_tecnica_id = $1
         ORDER BY itf.id`,
        [ficha.id]
    );

    return montarResposta(ficha, itensRows);
}

async function buscarHistoricoPorProduto(produto_id, empresa_id) {
    const { rows } = await db.query(
        'SELECT * FROM fichas_tecnicas WHERE produto_id = $1 AND empresa_id = $2 ORDER BY criado_em DESC, id DESC',
        [produto_id, empresa_id]
    );

    const fichas = [];

    for (const ficha of rows) {
        const { rows: itensRows } = await db.query(
            `SELECT itf.id, itf.insumo_produto_id, itf.quantidade_necessaria, p.custo AS custo_unitario, p.nome AS insumo_nome
             FROM itens_ficha_tecnica itf
             JOIN produtos p ON p.id = itf.insumo_produto_id
             WHERE itf.ficha_tecnica_id = $1
             ORDER BY itf.id`,
            [ficha.id]
        );

        fichas.push(montarResposta(ficha, itensRows));
    }

    return fichas;
}

module.exports = {
    criarVersao,
    buscarVigentePorProduto,
    buscarHistoricoPorProduto
};
