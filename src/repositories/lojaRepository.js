const db = require('../config/db');
const AppError = require('../errors/AppError');
const imagensStorage = require('../services/storage/imagensStorage');
const { executarComLock } = require('./shared/transacoes');
const { NOVIDADE_DIAS, MAX_FOTOS_PUBLICAS, QUANTIDADE_MAXIMA_EXIBIDA } = require('../constants/loja');

// Loja online: leitura PÚBLICA do catálogo e gestão da marcação de produto.
//
// Fronteira de dados (regra inviolável): as consultas públicas escolhem coluna por coluna o que sai. Custo,
// margem, markup, fornecedor, estoque por local, estoque mínimo, id interno de produto/empresa e o texto
// interno `produtos.descricao` NUNCA são selecionados aqui; o teste lojaCatalogo garante que não aparecem.
//
// A empresa é decidida AQUI, no servidor: pelo slug da URL (identificador público) e só se a empresa estiver
// ativa e com a funcionalidade `loja_online` ligada pelas mesmas regras de sessaoRepository (plano inclui OU
// ligação avulsa vigente, E nenhum desligamento vigente). Qualquer outro caso é "não encontrada".

const HOJE_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

const LOJA_LIGADA_SQL = `
    e.status = 'ativa'
    AND (
        EXISTS (
            SELECT 1 FROM plano_funcionalidades pf
            WHERE pf.funcionalidade = 'loja_online'
              AND pf.plano_id = COALESCE(
                    (SELECT ep.plano_id FROM empresa_planos ep
                     WHERE ep.empresa_id = e.id AND ep.ativo = true
                       AND ep.vigencia_inicio <= ${HOJE_SQL}
                       AND (ep.vigencia_fim IS NULL OR ep.vigencia_fim >= ${HOJE_SQL})
                     ORDER BY ep.vigencia_inicio DESC, ep.id DESC LIMIT 1),
                    (SELECT pc.id FROM planos_comerciais pc WHERE pc.codigo = 'sem_mensalidade'))
        )
        OR EXISTS (
            SELECT 1 FROM empresa_funcionalidades ef
            WHERE ef.empresa_id = e.id AND ef.funcionalidade = 'loja_online' AND ef.ligada = true
              AND ef.vigencia_inicio <= ${HOJE_SQL} AND (ef.vigencia_fim IS NULL OR ef.vigencia_fim >= ${HOJE_SQL})
        )
    )
    AND NOT EXISTS (
        SELECT 1 FROM empresa_funcionalidades ef
        WHERE ef.empresa_id = e.id AND ef.funcionalidade = 'loja_online' AND ef.ligada = false
          AND ef.vigencia_inicio <= ${HOJE_SQL} AND (ef.vigencia_fim IS NULL OR ef.vigencia_fim >= ${HOJE_SQL})
    )`;

async function buscarEmpresaDaLoja(slug) {
    const { rows } = await db.query(
        `SELECT e.id AS empresa_id FROM empresas e WHERE e.slug = $1 AND ${LOJA_LIGADA_SQL}`,
        [slug]
    );

    return rows[0] ?? null;
}

// Fragmentos de SQL reaproveitados pela lista e pelo detalhe. Parâmetro $1 é sempre a empresa.
// Preço: o preço vigente do canal `online` (mesma regra do PDV: o registro mais recente). Estoque: só o saldo do
// local Central (maleta, consignado, trânsito e a futura reserva online não contam como disponível).
const BASE_SQL = `
    FROM produtos_loja pl
    JOIN produtos p ON p.id = pl.produto_id AND p.empresa_id = pl.empresa_id
    JOIN canais_venda cv ON cv.empresa_id = p.empresa_id AND cv.nome = 'online' AND cv.ativo = true
    JOIN LATERAL (
        SELECT pp.preco_venda FROM precos_produto pp
        WHERE pp.produto_id = p.id AND pp.empresa_id = p.empresa_id AND pp.canal_id = cv.id
        ORDER BY pp.criado_em DESC, pp.id DESC LIMIT 1
    ) preco ON preco.preco_venda > 0
    LEFT JOIN locais_estoque lc ON lc.empresa_id = p.empresa_id AND lc.tipo = 'central'
    LEFT JOIN estoque_locais el ON el.produto_id = p.id AND el.local_id = lc.id AND el.empresa_id = p.empresa_id
    WHERE pl.empresa_id = $1 AND pl.visivel = true AND p.ativo = true AND p.tipo = 'acabado'`;

const PRIMEIRA_ENTRADA_SQL = `(SELECT MIN(m.criado_em) FROM movimentacoes_estoque m
    WHERE m.produto_id = p.id AND m.empresa_id = p.empresa_id AND m.tipo = 'entrada')`;

const VENDIDAS_SQL = `COALESCE((SELECT SUM(iv.quantidade) FROM itens_venda iv
    JOIN vendas v ON v.id = iv.venda_id AND v.empresa_id = iv.empresa_id
    WHERE iv.produto_id = p.id AND iv.empresa_id = p.empresa_id AND v.status = 'finalizada'), 0)`;

// Colunas PÚBLICAS, uma a uma. `quantidade` bruta só é usada para derivar disponibilidade e sai limitada.
const COLUNAS_PUBLICAS_SQL = `
    pl.slug,
    COALESCE(NULLIF(btrim(pl.titulo), ''), p.nome) AS nome,
    pl.descricao, pl.materiais, pl.cuidados,
    preco.preco_venda AS preco,
    COALESCE(el.saldo, 0) AS saldo_central,
    (${PRIMEIRA_ENTRADA_SQL} >= NOW() - ($2::int * INTERVAL '1 day')) AS novidade,
    p.id AS _produto_id`;

function urlDaFoto(chave) {
    return imagensStorage.urlPublica(chave);
}

async function anexarCategoriasEFotos(linhas, empresa_id) {
    if (!linhas.length) return [];

    const ids = linhas.map((l) => l._produto_id);

    const [{ rows: categorias }, { rows: fotos }] = await Promise.all([
        db.query(
            `SELECT pc.produto_id, c.nivel, c.codigo, c.nome
               FROM produtos_categorias pc
               JOIN categorias_produto c ON c.id = pc.categoria_id AND c.empresa_id = pc.empresa_id
              WHERE pc.produto_id = ANY($1::int[]) AND pc.empresa_id = $2 AND c.deletado_em IS NULL
              ORDER BY pc.produto_id, c.nivel`,
            [ids, empresa_id]
        ),
        db.query(
            `SELECT produto_id, chave FROM produto_imagens
              WHERE produto_id = ANY($1::int[]) AND empresa_id = $2
              ORDER BY produto_id, ordem ASC, id ASC`,
            [ids, empresa_id]
        )
    ]);

    return linhas.map((l) => {
        const saldo = Number(l.saldo_central);
        const imagens = fotos
            .filter((f) => f.produto_id === l._produto_id)
            .map((f) => urlDaFoto(f.chave))
            .filter(Boolean)
            .slice(0, MAX_FOTOS_PUBLICAS);

        return {
            slug: l.slug,
            nome: l.nome,
            descricao: l.descricao,
            materiais: l.materiais,
            cuidados: l.cuidados,
            preco: Number(l.preco),
            disponivel: saldo > 0,
            quantidade_disponivel: Math.min(Math.max(saldo, 0), QUANTIDADE_MAXIMA_EXIBIDA),
            novidade: l.novidade === true,
            categorias: categorias
                .filter((c) => c.produto_id === l._produto_id)
                .map((c) => ({ nivel: c.nivel, codigo: c.codigo, nome: c.nome })),
            imagens
        };
    });
}

const ORDENS = {
    destaque: 'pl.ordem ASC, pl.produto_id ASC',
    novidades: `${PRIMEIRA_ENTRADA_SQL} DESC NULLS LAST, pl.produto_id DESC`,
    mais_vendidos: `${VENDIDAS_SQL} DESC, pl.produto_id ASC`,
    preco_asc: 'preco.preco_venda ASC, pl.produto_id ASC',
    preco_desc: 'preco.preco_venda DESC, pl.produto_id ASC',
    nome: `LOWER(COALESCE(NULLIF(btrim(pl.titulo), ''), p.nome)) ASC, pl.produto_id ASC`
};

function escaparLike(texto) {
    return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// filtros: { n1, n2, n3 (códigos de categoria por nível), q, preco_min, preco_max, novidades, disponivel, ordem,
//            limite, offset, somenteComVenda (interno) }. Tudo parametrizado; a ordem vem de uma lista fechada.
async function listarCatalogo(empresa_id, filtros) {
    const valores = [empresa_id, NOVIDADE_DIAS];
    const condicoes = [];

    for (const [nivel, codigo] of [[1, filtros.n1], [2, filtros.n2], [3, filtros.n3]]) {
        if (!codigo) continue;
        valores.push(nivel, codigo);
        condicoes.push(`EXISTS (
            SELECT 1 FROM produtos_categorias pc JOIN categorias_produto c ON c.id = pc.categoria_id AND c.empresa_id = pc.empresa_id
            WHERE pc.produto_id = p.id AND pc.empresa_id = p.empresa_id AND c.deletado_em IS NULL
              AND c.nivel = $${valores.length - 1} AND UPPER(c.codigo) = $${valores.length})`);
    }

    if (filtros.q) {
        valores.push(`%${escaparLike(filtros.q)}%`);
        condicoes.push(`(COALESCE(NULLIF(btrim(pl.titulo), ''), p.nome) ILIKE $${valores.length} ESCAPE '\\'
                         OR pl.descricao ILIKE $${valores.length} ESCAPE '\\')`);
    }

    if (filtros.preco_min != null) {
        valores.push(filtros.preco_min);
        condicoes.push(`preco.preco_venda >= $${valores.length}`);
    }

    if (filtros.preco_max != null) {
        valores.push(filtros.preco_max);
        condicoes.push(`preco.preco_venda <= $${valores.length}`);
    }

    if (filtros.novidades) {
        condicoes.push(`${PRIMEIRA_ENTRADA_SQL} >= NOW() - ($2::int * INTERVAL '1 day')`);
    }

    if (filtros.disponivel) {
        condicoes.push('COALESCE(el.saldo, 0) > 0');
    }

    // Uso interno (vitrine "Mais vendidos"): só peça com venda finalizada. Não é parâmetro da API pública.
    if (filtros.somenteComVenda) {
        condicoes.push(`${VENDIDAS_SQL} > 0`);
    }

    valores.push(filtros.limite, filtros.offset);
    const ordem = ORDENS[filtros.ordem] ?? ORDENS.destaque;

    const { rows } = await db.query(
        `SELECT ${COLUNAS_PUBLICAS_SQL}, COUNT(*) OVER() AS total
         ${BASE_SQL}${condicoes.length ? ` AND ${condicoes.join(' AND ')}` : ''}
         ORDER BY ${ordem}
         LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
        valores
    );

    return {
        total: rows.length ? Number(rows[0].total) : 0,
        itens: await anexarCategoriasEFotos(rows, empresa_id)
    };
}

async function buscarProdutoPorSlug(empresa_id, slug) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS_PUBLICAS_SQL} ${BASE_SQL} AND pl.slug = $3`,
        [empresa_id, NOVIDADE_DIAS, slug]
    );

    const [produto] = await anexarCategoriasEFotos(rows, empresa_id);
    return produto ?? null;
}

// Categorias que têm ao menos um produto visível à venda (para o menu e os filtros da loja).
async function listarCategoriasComProdutos(empresa_id) {
    const { rows } = await db.query(
        `SELECT c.nivel, c.codigo, c.nome, COUNT(DISTINCT p.id)::int AS quantidade
         ${BASE_SQL.replace('WHERE pl.empresa_id', `JOIN produtos_categorias pc ON pc.produto_id = p.id AND pc.empresa_id = p.empresa_id
         JOIN categorias_produto c ON c.id = pc.categoria_id AND c.empresa_id = pc.empresa_id AND c.deletado_em IS NULL
         WHERE pl.empresa_id`)}
         GROUP BY c.nivel, c.codigo, c.nome
         ORDER BY c.nivel, c.nome`,
        [empresa_id]
    );

    return rows;
}

// Quantas peças da loja têm ao menos uma venda finalizada (decide se "Mais vendidos" aparece).
async function contarComVenda(empresa_id) {
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS total ${BASE_SQL} AND ${VENDIDAS_SQL} > 0`,
        [empresa_id]
    );

    return rows[0].total;
}

// ---- Gestão (rotas autenticadas; empresa vem do JWT) ----

function slugDoProduto(nome, produto_id) {
    const base = String(nome)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 140).replace(/-+$/g, '');

    return base ? `${base}-${produto_id}` : `produto-${produto_id}`;
}

const COLUNAS_GESTAO = 'produto_id, visivel, slug, titulo, descricao, materiais, cuidados, ordem, publicado_em, atualizado_em';

// Devolve a marcação da loja e, junto, `cadastro`: o que já está escrito no cadastro do produto (nome, descrição e
// material = categorias de nível 2). Serve SÓ para o admin pré-preencher o formulário e conferir antes de salvar:
// nada daqui vai para a loja pública sem ele salvar. É a única rota que expõe `produtos.descricao`, e só para admin.
async function buscarMarcacao(produto_id, empresa_id) {
    const { rows: produto } = await db.query(
        'SELECT id, nome, descricao FROM produtos WHERE id = $1 AND empresa_id = $2',
        [produto_id, empresa_id]
    );

    if (!produto.length) throw new AppError('Produto não encontrado', 404);

    const [{ rows }, { rows: materiais }] = await Promise.all([
        db.query(`SELECT ${COLUNAS_GESTAO} FROM produtos_loja WHERE produto_id = $1 AND empresa_id = $2`, [produto_id, empresa_id]),
        db.query(
            `SELECT c.nome FROM produtos_categorias pc
               JOIN categorias_produto c ON c.id = pc.categoria_id AND c.empresa_id = pc.empresa_id
              WHERE pc.produto_id = $1 AND pc.empresa_id = $2 AND c.nivel = 2
              ORDER BY c.nome`,
            [produto_id, empresa_id]
        )
    ]);

    const cadastro = {
        nome: produto[0].nome,
        descricao: produto[0].descricao?.trim() || null,
        material: materiais.map((m) => m.nome).join(', ') || null
    };
    const marcacao = rows[0] ?? { produto_id, visivel: false, slug: null, titulo: null, descricao: null, materiais: null, cuidados: null, ordem: 0, publicado_em: null, atualizado_em: null };

    return { ...marcacao, cadastro };
}

// Cria ou atualiza a marcação sob lock da linha do produto. Só produto acabado e ativo pode ficar visível.
// O slug é gerado na primeira marcação e nunca muda (URL estável). Campos ausentes não são alterados.
async function salvarMarcacao(produto_id, empresa_id, dados) {
    return executarComLock('produtos', { coluna: 'id', valor: produto_id }, empresa_id, null, async (produto, client) => {
        if (!produto) throw new AppError('Produto não encontrado', 404);

        const { rows: atual } = await client.query(
            `SELECT ${COLUNAS_GESTAO} FROM produtos_loja WHERE produto_id = $1 AND empresa_id = $2`,
            [produto_id, empresa_id]
        );

        const visivelFinal = dados.visivel ?? atual[0]?.visivel ?? false;

        if (visivelFinal && (produto.tipo !== 'acabado' || !produto.ativo)) {
            throw new AppError('Só produto acabado e ativo pode ser publicado na loja', 409);
        }

        const campo = (nome) => (nome in dados ? dados[nome] : (atual[0]?.[nome] ?? null));

        if (!atual.length) {
            const { rows } = await client.query(
                `INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug, titulo, descricao, materiais, cuidados, ordem, publicado_em)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $3 THEN NOW() END)
                 RETURNING ${COLUNAS_GESTAO}`,
                [produto_id, empresa_id, visivelFinal, slugDoProduto(produto.nome, produto_id),
                    campo('titulo'), campo('descricao'), campo('materiais'), campo('cuidados'), dados.ordem ?? 0]
            );
            return rows[0];
        }

        const { rows } = await client.query(
            `UPDATE produtos_loja
                SET visivel = $3, titulo = $4, descricao = $5, materiais = $6, cuidados = $7, ordem = $8,
                    publicado_em = COALESCE(publicado_em, CASE WHEN $3 THEN NOW() END),
                    atualizado_em = NOW()
              WHERE produto_id = $1 AND empresa_id = $2
              RETURNING ${COLUNAS_GESTAO}`,
            [produto_id, empresa_id, visivelFinal, campo('titulo'), campo('descricao'), campo('materiais'), campo('cuidados'), dados.ordem ?? atual[0].ordem]
        );
        return rows[0];
    });
}

module.exports = {
    buscarEmpresaDaLoja,
    listarCatalogo,
    buscarProdutoPorSlug,
    listarCategoriasComProdutos,
    contarComVenda,
    buscarMarcacao,
    salvarMarcacao,
    slugDoProduto
};
