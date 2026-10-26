const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');

const COLUNAS = 'id, produto_id, chave, content_type, tamanho_bytes, ordem, criado_em';

async function listarPorProduto(produto_id, empresa_id) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS} FROM produto_imagens
          WHERE produto_id = $1 AND empresa_id = $2
          ORDER BY ordem ASC, id ASC`,
        [produto_id, empresa_id]
    );
    return rows;
}

// Foto principal (menor ordem) de vários produtos de uma vez, para a listagem.
async function principaisPorProdutoIds(produtoIds, empresa_id) {
    if (!produtoIds.length) return [];

    const { rows } = await db.query(
        `SELECT DISTINCT ON (produto_id) produto_id, chave
           FROM produto_imagens
          WHERE produto_id = ANY($1::int[]) AND empresa_id = $2
          ORDER BY produto_id, ordem ASC, id ASC`,
        [produtoIds, empresa_id]
    );
    return rows;
}

// Insere a foto no fim da galeria. Trava a linha do produto para que dois uploads simultâneos não
// passem do limite. Lança 404 (produto de outra empresa/inexistente) ou 409 (galeria cheia).
async function inserir({ produto_id, empresa_id, chave, content_type, tamanho_bytes, criado_por, limite }) {
    return executarComLock('produtos', { coluna: 'id', valor: produto_id }, empresa_id, null, async (produto, client) => {
        if (!produto) throw new AppError('Produto não encontrado', 404);

        const { rows: contagem } = await client.query(
            `SELECT COUNT(*)::int AS total, COALESCE(MAX(ordem), -1) + 1 AS proxima
               FROM produto_imagens WHERE produto_id = $1 AND empresa_id = $2`,
            [produto_id, empresa_id]
        );

        if (contagem[0].total >= limite) {
            throw new AppError(`Cada produto aceita no máximo ${limite} fotos`, 409);
        }

        const { rows } = await client.query(
            `INSERT INTO produto_imagens (empresa_id, produto_id, chave, content_type, tamanho_bytes, ordem, criado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING ${COLUNAS}`,
            [empresa_id, produto_id, chave, content_type, tamanho_bytes, contagem[0].proxima, criado_por]
        );

        return rows[0];
    });
}

// Apaga a linha e devolve ela (com a chave, para o service apagar o objeto). Reordena as restantes
// para manter 0..n-1, então a "principal" é sempre a de ordem 0.
async function remover(id, produto_id, empresa_id) {
    return executarComLock('produtos', { coluna: 'id', valor: produto_id }, empresa_id, null, async (produto, client) => {
        if (!produto) throw new AppError('Produto não encontrado', 404);

        const { rows } = await client.query(
            `DELETE FROM produto_imagens WHERE id = $1 AND produto_id = $2 AND empresa_id = $3 RETURNING ${COLUNAS}`,
            [id, produto_id, empresa_id]
        );

        if (!rows.length) throw new AppError('Foto não encontrada', 404);

        await client.query(
            `UPDATE produto_imagens p SET ordem = n.nova
               FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY ordem, id) - 1 AS nova
                       FROM produto_imagens WHERE produto_id = $1 AND empresa_id = $2) n
              WHERE p.id = n.id AND p.ordem <> n.nova`,
            [produto_id, empresa_id]
        );

        return rows[0];
    });
}

// Define a nova ordem. `ids` precisa ser exatamente o conjunto de fotos do produto (sem faltar nem sobrar).
async function reordenar(produto_id, empresa_id, ids) {
    return executarComLock('produtos', { coluna: 'id', valor: produto_id }, empresa_id, null, async (produto, client) => {
        if (!produto) throw new AppError('Produto não encontrado', 404);

        const { rows: atuais } = await client.query(
            'SELECT id FROM produto_imagens WHERE produto_id = $1 AND empresa_id = $2',
            [produto_id, empresa_id]
        );

        const atuaisIds = atuais.map((r) => r.id).sort((a, b) => a - b);
        const novosIds = [...ids].sort((a, b) => a - b);

        if (atuaisIds.length !== novosIds.length || atuaisIds.some((id, i) => id !== novosIds[i])) {
            throw new AppError('A lista de fotos deve conter exatamente as fotos atuais do produto, sem repetir', 400);
        }

        for (let i = 0; i < ids.length; i += 1) {
            await client.query(
                'UPDATE produto_imagens SET ordem = $1 WHERE id = $2 AND produto_id = $3 AND empresa_id = $4',
                [i, ids[i], produto_id, empresa_id]
            );
        }

        const { rows } = await client.query(
            `SELECT ${COLUNAS} FROM produto_imagens WHERE produto_id = $1 AND empresa_id = $2 ORDER BY ordem, id`,
            [produto_id, empresa_id]
        );

        return rows;
    });
}

module.exports = { listarPorProduto, principaisPorProdutoIds, inserir, remover, reordenar };
