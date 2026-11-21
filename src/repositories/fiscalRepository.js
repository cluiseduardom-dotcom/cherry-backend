const db = require('../config/db');
const AppError = require('../errors/AppError');

// Preparo fiscal (migration 126). Toda consulta leva empresa_id (do JWT). Só cadastro: nada é emitido.

const COLUNAS_FISCAIS_EMPRESA = ['regime_tributario', 'inscricao_estadual', 'inscricao_municipal', 'cnae_principal', 'codigo_municipio_ibge', 'ambiente'];
const COLUNAS_FISCAIS_PRODUTO = ['ncm', 'cest', 'origem_mercadoria', 'unidade_fiscal'];
const SELECT_PRODUTO_FISCAL = `id, sku, nome, tipo, unidade, ativo, ncm, cest, origem_mercadoria, unidade_fiscal`;

async function buscarEmpresa(empresaId) {
    const { rows } = await db.query(
        `SELECT e.razao_social, e.cnpj, e.cep, e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.uf,
                f.regime_tributario, f.inscricao_estadual, f.inscricao_municipal, f.cnae_principal, f.codigo_municipio_ibge,
                COALESCE(f.ambiente, 'homologacao') AS ambiente
           FROM empresas e
           LEFT JOIN empresa_fiscal f ON f.empresa_id = e.id
          WHERE e.id = $1`,
        [empresaId]
    );

    return rows[0] ?? null;
}

// Grava só os campos enviados (null limpa). Cria a linha da empresa se ainda não existe.
async function salvarFiscalEmpresa(empresaId, usuarioId, dados) {
    const colunas = COLUNAS_FISCAIS_EMPRESA.filter((c) => dados[c] !== undefined);
    const valores = colunas.map((c) => dados[c]);
    const insercao = ['empresa_id', ...colunas, 'atualizado_por'];
    const placeholders = insercao.map((_, i) => `$${i + 1}`);
    const atualiza = [...colunas.map((c) => `${c} = EXCLUDED.${c}`), 'atualizado_por = EXCLUDED.atualizado_por', 'atualizado_em = NOW()'];

    await db.query(
        `INSERT INTO empresa_fiscal (${insercao.join(', ')}) VALUES (${placeholders.join(', ')})
         ON CONFLICT (empresa_id) DO UPDATE SET ${atualiza.join(', ')}`,
        [empresaId, ...valores, usuarioId]
    );
}

async function listarProdutos({ empresaId, filtro, q, limit, offset }) {
    const condicoes = [`p.empresa_id = $1`, `p.tipo = 'acabado'`];
    const valores = [empresaId];

    if (filtro === 'pendentes') condicoes.push('(p.ncm IS NULL OR p.origem_mercadoria IS NULL)');

    if (q) {
        valores.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
        condicoes.push(`(p.nome ILIKE $${valores.length} OR p.sku ILIKE $${valores.length})`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;
    const { rows } = await db.query(
        `SELECT ${SELECT_PRODUTO_FISCAL.split(', ').map((c) => `p.${c}`).join(', ')} FROM produtos p ${where}
          ORDER BY p.nome, p.id LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, limit, offset]
    );
    const { rows: contagem } = await db.query(`SELECT COUNT(*)::int AS total FROM produtos p ${where}`, valores);

    return { items: rows, total: contagem[0].total };
}

function setsDeProduto(dados) {
    const colunas = COLUNAS_FISCAIS_PRODUTO.filter((c) => dados[c] !== undefined);

    return { colunas, valores: colunas.map((c) => dados[c]) };
}

async function atualizarProduto(id, empresaId, dados) {
    const { colunas, valores } = setsDeProduto(dados);
    const sets = colunas.map((c, i) => `${c} = $${i + 1}`);
    const { rows } = await db.query(
        `UPDATE produtos SET ${sets.join(', ')} WHERE id = $${colunas.length + 1} AND empresa_id = $${colunas.length + 2} RETURNING ${SELECT_PRODUTO_FISCAL}`,
        [...valores, id, empresaId]
    );

    return rows[0] ?? null;
}

// Todos os ids precisam ser da empresa; se algum não for, nada é aplicado.
async function atualizarLote(ids, empresaId, dados) {
    const { colunas, valores } = setsDeProduto(dados);
    const sets = colunas.map((c, i) => `${c} = $${i + 1}`);
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: existentes } = await client.query('SELECT id FROM produtos WHERE id = ANY($1::int[]) AND empresa_id = $2 FOR UPDATE', [ids, empresaId]);

        if (existentes.length !== ids.length) throw new AppError('Produto não encontrado', 404);

        await client.query(
            `UPDATE produtos SET ${sets.join(', ')} WHERE id = ANY($${colunas.length + 1}::int[]) AND empresa_id = $${colunas.length + 2}`,
            [...valores, ids, empresaId]
        );
        await client.query('COMMIT');

        return ids.length;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Produtos vendidos (acabados e ativos): quantos há e quantos já têm cada dado fiscal.
async function contagemProdutos(empresaId) {
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(ncm)::int AS com_ncm,
                COUNT(origem_mercadoria)::int AS com_origem,
                COUNT(unidade_fiscal)::int AS com_unidade_fiscal
           FROM produtos WHERE empresa_id = $1 AND tipo = 'acabado' AND ativo = true`,
        [empresaId]
    );

    return rows[0];
}

async function produtosPendentes(empresaId, limite = 10) {
    const { rows } = await db.query(
        `SELECT id, sku, nome, (ncm IS NULL) AS sem_ncm, (origem_mercadoria IS NULL) AS sem_origem
           FROM produtos
          WHERE empresa_id = $1 AND tipo = 'acabado' AND ativo = true AND (ncm IS NULL OR origem_mercadoria IS NULL)
          ORDER BY nome, id LIMIT $2`,
        [empresaId, limite]
    );

    return rows;
}

module.exports = { buscarEmpresa, salvarFiscalEmpresa, listarProdutos, atualizarProduto, atualizarLote, contagemProdutos, produtosPendentes };
