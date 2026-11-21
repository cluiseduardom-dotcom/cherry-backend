const db = require('../config/db');
const { executarComLock } = require('./shared/transacoes');
const AppError = require('../errors/AppError');

// Grade de produtos (migration 125): cada variação é um produto normal ligado à grade. Toda consulta leva empresa_id.
// Criar grade e variações é atômico; SKU (categorias) é gerado depois, pelo mesmo caminho de sempre (produtosService.categorizar).

const NOME_REPETIDO = 'Já existe uma grade com este nome';

function erroDeNomeRepetido(error) {
    return error?.code === '23505' && String(error.constraint ?? '').includes('idx_grades_produto_nome_unico');
}

const COLUNAS_VARIACAO = 'id, sku, nome, variacao, estoque_atual, estoque_minimo, preco_venda, custo, unidade, ativo';

async function inserirVariacoes(client, { empresaId, gradeId, grade, variacoes }) {
    const criados = [];

    for (const v of variacoes) {
        const { rows } = await client.query(
            `INSERT INTO produtos (empresa_id, nome, descricao, preco_venda, custo, estoque_atual, estoque_minimo, ativo, tipo, unidade, grade_id, variacao)
             VALUES ($1, $2, $3, $4, $5, 0, $6, true, 'acabado', $7, $8, $9)
             RETURNING ${COLUNAS_VARIACAO}`,
            [empresaId, v.nome, grade.descricao ?? null, grade.preco_venda ?? null, v.custo ?? grade.custo, grade.estoque_minimo ?? 0, grade.unidade ?? 'UN', gradeId, JSON.stringify(v.valores)]
        );

        criados.push(rows[0]);
    }

    return criados;
}

async function criar({ empresa_id: empresaId, usuario_id: usuarioId, grade, variacoes }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `INSERT INTO grades_produto (empresa_id, nome, descricao, eixos, custo, preco_venda, unidade, estoque_minimo, categorias_comuns, criado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                empresaId, grade.nome, grade.descricao ?? null, JSON.stringify(grade.eixos), grade.custo, grade.preco_venda ?? null,
                grade.unidade ?? 'UN', grade.estoque_minimo ?? 0, JSON.stringify(grade.categorias_comuns ?? []), usuarioId
            ]
        );
        const criada = rows[0];
        const produtos = await inserirVariacoes(client, { empresaId, gradeId: criada.id, grade: criada, variacoes });

        await client.query('COMMIT');

        return { grade: criada, variacoes: produtos };
    } catch (error) {
        await client.query('ROLLBACK');

        if (erroDeNomeRepetido(error)) throw new AppError(NOME_REPETIDO, 409);

        throw error;
    } finally {
        client.release();
    }
}

// Acrescenta variações a uma grade existente. Trava a grade (duas inclusões simultâneas não repetem combinação)
// e recusa combinação já existente, sem diferenciar maiúsculas; se alguma repetir, nenhuma entra.
async function acrescentar({ grade_id: gradeId, empresa_id: empresaId, variacoes }) {
    return executarComLock('grades_produto', { coluna: 'id', valor: gradeId }, empresaId, undefined, async (grade, client) => {
        if (!grade) throw new AppError('Grade não encontrada', 404);

        const { rows: existentes } = await client.query('SELECT variacao FROM produtos WHERE grade_id = $1 AND empresa_id = $2', [gradeId, empresaId]);
        const chave = (valores) => JSON.stringify(grade.eixos.map((e) => String(valores[e] ?? '').trim().toLowerCase()));
        const jaExistem = new Set(existentes.map((p) => chave(p.variacao)));

        if (variacoes.some((v) => jaExistem.has(chave(v.valores)))) {
            throw new AppError('Já existe uma variação com essa combinação nesta grade', 409);
        }

        return { grade, variacoes: await inserirVariacoes(client, { empresaId, gradeId, grade, variacoes }) };
    });
}

async function listarPaginado({ limit, offset, empresa_id: empresaId }) {
    const { rows } = await db.query(
        `SELECT g.id, g.nome, g.descricao, g.eixos, g.criado_em,
                COUNT(p.id)::int AS variacoes, COALESCE(SUM(p.estoque_atual), 0)::int AS estoque_total
           FROM grades_produto g
           LEFT JOIN produtos p ON p.grade_id = g.id AND p.empresa_id = g.empresa_id
          WHERE g.empresa_id = $1
          GROUP BY g.id
          ORDER BY g.nome, g.id
          LIMIT $2 OFFSET $3`,
        [empresaId, limit, offset]
    );
    const { rows: contagem } = await db.query('SELECT COUNT(*)::int AS total FROM grades_produto WHERE empresa_id = $1', [empresaId]);

    return { items: rows, total: contagem[0].total };
}

async function buscarPorId(id, empresaId) {
    const { rows } = await db.query('SELECT * FROM grades_produto WHERE id = $1 AND empresa_id = $2', [id, empresaId]);

    if (!rows.length) return null;

    const { rows: variacoes } = await db.query(
        `SELECT ${COLUNAS_VARIACAO} FROM produtos WHERE grade_id = $1 AND empresa_id = $2 ORDER BY id`,
        [id, empresaId]
    );

    return { grade: rows[0], variacoes };
}

async function atualizar(id, dados, empresaId) {
    const sets = [];
    const valores = [];

    for (const campo of ['nome', 'descricao']) {
        if (dados[campo] !== undefined) {
            valores.push(dados[campo]);
            sets.push(`${campo} = $${valores.length}`);
        }
    }

    valores.push(id, empresaId);

    try {
        const { rows } = await db.query(
            `UPDATE grades_produto SET ${sets.join(', ')}, atualizado_em = NOW() WHERE id = $${valores.length - 1} AND empresa_id = $${valores.length} RETURNING id`,
            valores
        );

        return rows.length > 0;
    } catch (error) {
        if (erroDeNomeRepetido(error)) throw new AppError(NOME_REPETIDO, 409);

        throw error;
    }
}

module.exports = { criar, acrescentar, listarPaginado, buscarPorId, atualizar };
