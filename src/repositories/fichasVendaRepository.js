const db = require('../config/db');
const AppError = require('../errors/AppError');
const { calcularCustoSku } = require('../utils/custoSku');
const { executarComLock } = require('./shared/transacoes');

const SELECT_ITENS = `
    SELECT i.id, i.insumo_produto_id, i.quantidade, p.nome AS insumo_nome, p.sku AS insumo_sku, p.custo AS custo_unitario
    FROM itens_ficha_venda i
    JOIN produtos p ON p.id = i.insumo_produto_id AND p.empresa_id = i.empresa_id
    WHERE i.ficha_venda_id = $1 AND i.empresa_id = $2
    ORDER BY i.id`;

function montarResposta(ficha, produto, itensRows) {
    const custo = calcularCustoSku(produto.custo, itensRows);

    return {
        id: ficha.id,
        produto_id: ficha.produto_id,
        vigente: ficha.vigente,
        criado_por: ficha.criado_por,
        criado_em: ficha.criado_em,
        itens: custo.itens.map((item) => ({
            id: item.id,
            insumo_produto_id: item.insumo_produto_id,
            insumo_nome: item.insumo_nome,
            insumo_sku: item.insumo_sku,
            quantidade: item.quantidade,
            custo_unitario: Number(item.custo_unitario),
            subtotal_custo: item.subtotal_custo
        })),
        custo_item: custo.custo_item,
        custo_insumos: custo.custo_insumos,
        custo_total_sku: custo.custo_total_sku
    };
}

// Uma transação: trava o produto (serializa duas edições da mesma ficha), valida produto 'acabado' e cada
// insumo ('insumo', ativo, mesma empresa), derruba a versão vigente e insere a nova — nessa ordem, por causa
// do índice único parcial. Nunca faz UPDATE para editar uma ficha.
async function criarVersao({ produto_id, itens, usuario_id, empresa_id }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: produtoRows } = await client.query(
            'SELECT id, tipo, custo FROM produtos WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
            [produto_id, empresa_id]
        );

        if (!produtoRows.length) {
            throw new AppError('Produto não encontrado', 404);
        }

        if (produtoRows[0].tipo !== 'acabado') {
            throw new AppError("Só produto do tipo 'acabado' tem ficha de venda", 400);
        }

        if (itens.length) {
            const ids = itens.map((item) => item.insumo_produto_id);
            const { rows: insumoRows } = await client.query(
                'SELECT id, tipo, ativo FROM produtos WHERE empresa_id = $1 AND id = ANY($2::int[])',
                [empresa_id, ids]
            );
            const porId = new Map(insumoRows.map((r) => [r.id, r]));

            for (const id of ids) {
                const insumo = porId.get(id);

                if (!insumo) throw new AppError('Insumo não encontrado', 404);
                if (insumo.tipo !== 'insumo') throw new AppError(`Produto ${id} deve ser do tipo 'insumo'`, 400);
                if (!insumo.ativo) throw new AppError(`Insumo ${id} está inativo`, 400);
            }
        }

        await client.query(
            'UPDATE fichas_venda SET vigente = false WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true',
            [produto_id, empresa_id]
        );

        const { rows: fichaRows } = await client.query(
            `INSERT INTO fichas_venda (empresa_id, produto_id, vigente, criado_por)
             VALUES ($1, $2, true, $3) RETURNING *`,
            [empresa_id, produto_id, usuario_id]
        );
        const ficha = fichaRows[0];

        for (const item of itens) {
            await client.query(
                `INSERT INTO itens_ficha_venda (empresa_id, ficha_venda_id, insumo_produto_id, quantidade)
                 VALUES ($1, $2, $3, $4)`,
                [empresa_id, ficha.id, item.insumo_produto_id, item.quantidade]
            );
        }

        const { rows: itensRows } = await client.query(SELECT_ITENS, [ficha.id, empresa_id]);

        await client.query('COMMIT');

        return montarResposta(ficha, produtoRows[0], itensRows);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function buscarVigentePorProduto(produto_id, empresa_id) {
    const { rows: produtoRows } = await db.query(
        'SELECT id, custo FROM produtos WHERE id = $1 AND empresa_id = $2',
        [produto_id, empresa_id]
    );

    if (!produtoRows.length) return { produto: null, ficha: null };

    const { rows } = await db.query(
        'SELECT * FROM fichas_venda WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true',
        [produto_id, empresa_id]
    );

    if (!rows.length) return { produto: produtoRows[0], ficha: null };

    const { rows: itensRows } = await db.query(SELECT_ITENS, [rows[0].id, empresa_id]);

    return { produto: produtoRows[0], ficha: montarResposta(rows[0], produtoRows[0], itensRows) };
}

async function buscarHistoricoPorProduto(produto_id, empresa_id) {
    const { rows: produtoRows } = await db.query(
        'SELECT id, custo FROM produtos WHERE id = $1 AND empresa_id = $2',
        [produto_id, empresa_id]
    );

    if (!produtoRows.length) return null;

    const { rows } = await db.query(
        'SELECT * FROM fichas_venda WHERE produto_id = $1 AND empresa_id = $2 ORDER BY criado_em DESC, id DESC',
        [produto_id, empresa_id]
    );

    const fichas = [];

    for (const ficha of rows) {
        const { rows: itensRows } = await db.query(SELECT_ITENS, [ficha.id, empresa_id]);
        fichas.push(montarResposta(ficha, produtoRows[0], itensRows));
    }

    return fichas;
}

const QUANTIDADE_MAXIMA_FICHA = 1000;

// Fichas VIGENTES que usam o insumo (produto, quantidade por unidade). Para a prévia da substituição em lote.
async function listarFichasVigentesComInsumo(insumo_id, empresa_id, executor = db) {
    const { rows } = await executor.query(
        `SELECT f.id AS ficha_venda_id, f.produto_id, p.sku, p.nome, i.quantidade
         FROM fichas_venda f
         JOIN itens_ficha_venda i ON i.ficha_venda_id = f.id AND i.empresa_id = f.empresa_id
         JOIN produtos p ON p.id = f.produto_id AND p.empresa_id = f.empresa_id
         WHERE f.empresa_id = $1 AND f.vigente = true AND i.insumo_produto_id = $2
         ORDER BY f.produto_id`,
        [empresa_id, insumo_id]
    );

    return rows;
}

async function previaSubstituicao(de_insumo_id, empresa_id) {
    const { rows } = await db.query(
        'SELECT id, tipo, sku, nome FROM produtos WHERE id = $1 AND empresa_id = $2',
        [de_insumo_id, empresa_id]
    );
    if (!rows.length) throw new AppError('Insumo não encontrado', 404);
    if (rows[0].tipo !== 'insumo') throw new AppError("Produto deve ser do tipo 'insumo'", 400);

    return { insumo: rows[0], afetados: await listarFichasVigentesComInsumo(de_insumo_id, empresa_id) };
}

// Substituição em lote ("em todos os SKUs que usam a embalagem X, trocar por Y"): para cada ficha vigente que usa X,
// cria uma NOVA versão com Y no lugar (quantidade preservada; se Y já estava na ficha, as quantidades somam). Nunca
// edita versão antiga; vendas passadas guardam o próprio snapshot. Tudo numa transação; o insumo substituído é
// travado (serializa duas substituições do mesmo insumo) e os produtos afetados são travados em ordem de id.
async function substituirInsumoEmLote({ de_insumo_id, para_insumo_id, usuario_id, empresa_id }) {
    return executarComLock('produtos', { coluna: 'id', valor: de_insumo_id }, empresa_id, undefined, async (de, client) => {
        if (!de) throw new AppError('Insumo atual não encontrado', 404);
        if (de.tipo !== 'insumo') throw new AppError("O insumo atual deve ser do tipo 'insumo'", 400);

        const { rows: paraRows } = await client.query(
            'SELECT id, tipo, ativo FROM produtos WHERE id = $1 AND empresa_id = $2',
            [para_insumo_id, empresa_id]
        );
        if (!paraRows.length) throw new AppError('Insumo substituto não encontrado', 404);
        if (paraRows[0].tipo !== 'insumo') throw new AppError("O insumo substituto deve ser do tipo 'insumo'", 400);
        if (!paraRows[0].ativo) throw new AppError('O insumo substituto está inativo', 400);

        const afetados = await listarFichasVigentesComInsumo(de_insumo_id, empresa_id, client);
        if (!afetados.length) return { afetados: [] };

        await client.query(
            'SELECT id FROM produtos WHERE empresa_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE',
            [empresa_id, afetados.map((a) => a.produto_id)]
        );

        for (const afetado of afetados) {
            const { rows: itens } = await client.query(
                'SELECT insumo_produto_id, quantidade FROM itens_ficha_venda WHERE ficha_venda_id = $1 AND empresa_id = $2 ORDER BY id',
                [afetado.ficha_venda_id, empresa_id]
            );

            const novos = new Map();
            for (const item of itens) {
                const insumoId = item.insumo_produto_id === de_insumo_id ? para_insumo_id : item.insumo_produto_id;
                novos.set(insumoId, (novos.get(insumoId) ?? 0) + item.quantidade);
            }

            for (const quantidade of novos.values()) {
                if (quantidade > QUANTIDADE_MAXIMA_FICHA) {
                    throw new AppError(`A substituição passaria de ${QUANTIDADE_MAXIMA_FICHA} un. por venda no SKU ${afetado.sku || afetado.nome}`, 400);
                }
            }

            await client.query(
                'UPDATE fichas_venda SET vigente = false WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true',
                [afetado.produto_id, empresa_id]
            );
            const { rows: fichaRows } = await client.query(
                `INSERT INTO fichas_venda (empresa_id, produto_id, vigente, criado_por) VALUES ($1, $2, true, $3) RETURNING id`,
                [empresa_id, afetado.produto_id, usuario_id]
            );
            for (const [insumoId, quantidade] of novos) {
                await client.query(
                    `INSERT INTO itens_ficha_venda (empresa_id, ficha_venda_id, insumo_produto_id, quantidade) VALUES ($1, $2, $3, $4)`,
                    [empresa_id, fichaRows[0].id, insumoId, quantidade]
                );
            }
        }

        return { afetados: afetados.map(({ produto_id, sku, nome }) => ({ produto_id, sku, nome })) };
    });
}

module.exports = { criarVersao, buscarVigentePorProduto, buscarHistoricoPorProduto, previaSubstituicao, substituirInsumoEmLote };
