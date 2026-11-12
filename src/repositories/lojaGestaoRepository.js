const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');

// Gestão dos pedidos da loja online PELA EQUIPE (rotas autenticadas; empresa_id sempre do JWT).
// Aqui existe dado pessoal da cliente (nome, telefone, e-mail), por isso só admin e vendedor chegam (ver app.js) e nada
// disto sai pelas rotas públicas da loja. Nunca traz custo, margem, taxa da plataforma nem dados do provedor.

const SITUACOES = {
    a_combinar: `p.status = 'pago' AND p.entrega_combinada_em IS NULL`,
    combinadas: `p.status = 'pago' AND p.entrega_combinada_em IS NOT NULL`,
    todos: 'TRUE'
};

const COLUNAS = `p.id, p.codigo, p.status, p.cliente_nome, p.cliente_telefone, p.cliente_email, p.total, p.criado_em, p.pago_em,
        p.entrega_combinada_em, p.entrega_observacao,
        COALESCE((SELECT json_agg(json_build_object('nome', i.nome, 'quantidade', i.quantidade) ORDER BY i.produto_id)
                    FROM itens_pedido_loja i WHERE i.pedido_id = p.id AND i.empresa_id = p.empresa_id), '[]'::json) AS itens`;

function paraResposta(p) {
    return {
        codigo: p.codigo,
        codigo_curto: String(p.codigo).slice(0, 8).toUpperCase(),
        status: p.status,
        cliente: { nome: p.cliente_nome, telefone: p.cliente_telefone, email: p.cliente_email },
        itens: p.itens,
        total: Number(p.total),
        criado_em: p.criado_em,
        pago_em: p.pago_em,
        entrega_combinada_em: p.entrega_combinada_em,
        entrega_observacao: p.entrega_observacao
    };
}

// `situacao` vem de lista fechada (validada na entrada) e só escolhe um trecho fixo de SQL.
async function listarPedidos({ empresa_id, situacao, limit, offset }) {
    const filtro = SITUACOES[situacao];

    if (!filtro) throw new AppError('Situação inválida', 400);

    // Fila de contato: o mais antigo primeiro (quem espera há mais tempo). Histórico: o mais novo primeiro.
    const ordem = situacao === 'a_combinar' ? 'p.pago_em ASC, p.id ASC' : 'p.criado_em DESC, p.id DESC';

    const { rows } = await db.query(
        `SELECT ${COLUNAS} FROM pedidos_loja p WHERE p.empresa_id = $1 AND ${filtro} ORDER BY ${ordem} LIMIT $2 OFFSET $3`,
        [empresa_id, limit, offset]
    );
    const { rows: [{ total }] } = await db.query(
        `SELECT COUNT(*)::int AS total FROM pedidos_loja p WHERE p.empresa_id = $1 AND ${filtro}`,
        [empresa_id]
    );

    return { itens: rows.map(paraResposta), total };
}

// Registra que a entrega foi combinada. Idempotente (marcar de novo devolve o mesmo registro). Só pedido PAGO.
async function marcarEntregaCombinada({ empresa_id, codigo, usuario_id, observacao }) {
    return executarComLock('pedidos_loja', { coluna: 'codigo', valor: codigo }, empresa_id, null, async (pedido, client) => {
        if (!pedido) throw new AppError('Pedido não encontrado', 404);
        if (pedido.status !== 'pago') throw new AppError('Só um pedido pago pode ter a entrega combinada', 409);

        if (pedido.entrega_combinada_em === null) {
            await client.query(
                `UPDATE pedidos_loja SET entrega_combinada_em = NOW(), entrega_combinada_por = $3, entrega_observacao = $4, atualizado_em = NOW()
                  WHERE id = $1 AND empresa_id = $2`,
                [pedido.id, empresa_id, usuario_id, observacao ?? null]
            );
            await client.query(
                `INSERT INTO pedidos_loja_eventos (empresa_id, pedido_id, tipo, status_anterior, status_novo, detalhes)
                 VALUES ($1, $2, 'entrega_combinada', 'pago', 'pago', $3)`,
                [empresa_id, pedido.id, JSON.stringify({ usuario_id })]
            );
        }

        const { rows } = await client.query(`SELECT ${COLUNAS} FROM pedidos_loja p WHERE p.id = $1 AND p.empresa_id = $2`, [pedido.id, empresa_id]);

        return paraResposta(rows[0]);
    });
}

// Base dos avisos do sino (dados mínimos; o texto é montado em utils/notificacoesLoja.js).
//  * aCombinar: pedidos pagos esperando contato;
//  * semVenda: pagamento RECEBIDO que não virou venda (peça acabou depois de o pedido expirar, ou conversão que não
//    concluiu) há mais de 5 minutos: a conversão automática leva até ~1 min, então menos que isso é normal.
async function listarParaAvisos(empresa_id) {
    const [{ rows: aCombinar }, { rows: semVenda }, { rows: estornadas }] = await Promise.all([
        db.query(
            `SELECT p.id, p.codigo, p.cliente_nome, p.cliente_telefone, p.total,
                    FLOOR(EXTRACT(EPOCH FROM (NOW() - p.pago_em)) / 3600)::int AS horas
               FROM pedidos_loja p
              WHERE p.empresa_id = $1 AND p.status = 'pago' AND p.entrega_combinada_em IS NULL
              ORDER BY p.pago_em ASC LIMIT 30`,
            [empresa_id]
        ),
        db.query(
            `SELECT p.id, p.codigo, p.status, p.cliente_nome, p.cliente_telefone, c.valor AS total
               FROM pedidos_loja p
               JOIN cobrancas_pagamento c ON c.codigo = p.cobranca_codigo AND c.empresa_id = p.empresa_id
              WHERE p.empresa_id = $1 AND p.status <> 'pago' AND c.status = 'pago' AND c.venda_id IS NULL
                AND c.atualizado_em < NOW() - INTERVAL '5 minutes'
              ORDER BY c.atualizado_em ASC LIMIT 30`,
            [empresa_id]
        ),
        // Pagamento estornado/contestado no provedor com a venda ainda finalizada: o sistema não desfaz a venda sozinho.
        db.query(
            `SELECT p.id, p.codigo, p.cliente_nome, p.cliente_telefone, c.valor AS total
               FROM pedidos_loja p
               JOIN cobrancas_pagamento c ON c.codigo = p.cobranca_codigo AND c.empresa_id = p.empresa_id
               JOIN vendas v ON v.id = c.venda_id AND v.empresa_id = c.empresa_id
              WHERE p.empresa_id = $1 AND p.status = 'pago' AND c.status = 'estornado' AND v.status = 'finalizada'
              ORDER BY c.atualizado_em DESC LIMIT 30`,
            [empresa_id]
        )
    ]);

    return { aCombinar, semVenda, estornadas };
}

// ---- Produtos da loja (gestão da marcação "mostrar na loja") ----
// Lista os produtos ACABADOS e ATIVOS da empresa com a marcação da loja e o que decide se a peça aparece de fato:
// preço no canal `online`, saldo no Central e fotos. Só admin chega aqui (ver app.js). Nunca traz custo nem margem.
const FILTROS_PRODUTOS = {
    todos: 'TRUE',
    publicados: 'COALESCE(pl.visivel, false)',
    nao_publicados: 'NOT COALESCE(pl.visivel, false)',
    no_carrossel: 'COALESCE(pl.carrossel_novidades, false)'
};

// Escapa os curingas do LIKE (barra, % e _): a busca da pessoa é texto literal.
const textoLiteral = (v) => String(v).replace(/[\\%_]/g, (c) => '\\' + c);

async function listarProdutosDaLoja({ empresa_id, situacao, busca, limit, offset }) {
    const filtro = FILTROS_PRODUTOS[situacao];

    if (!filtro) throw new AppError('Situação inválida', 400);

    const params = [empresa_id];
    let filtroBusca = '';

    if (busca) {
        params.push(`%${textoLiteral(busca)}%`);
        filtroBusca = `AND p.nome ILIKE $${params.length}`;
    }

    const base = `
        FROM produtos p
        LEFT JOIN produtos_loja pl ON pl.produto_id = p.id AND pl.empresa_id = p.empresa_id
        LEFT JOIN canais_venda cv ON cv.empresa_id = p.empresa_id AND cv.nome = 'online' AND cv.ativo = true
        LEFT JOIN LATERAL (
            SELECT pp.preco_venda FROM precos_produto pp
            WHERE pp.produto_id = p.id AND pp.empresa_id = p.empresa_id AND pp.canal_id = cv.id
            ORDER BY pp.criado_em DESC, pp.id DESC LIMIT 1
        ) preco ON true
        LEFT JOIN locais_estoque lc ON lc.empresa_id = p.empresa_id AND lc.tipo = 'central'
        LEFT JOIN estoque_locais el ON el.produto_id = p.id AND el.local_id = lc.id AND el.empresa_id = p.empresa_id
        WHERE p.empresa_id = $1 AND p.ativo = true AND p.tipo = 'acabado' AND ${filtro} ${filtroBusca}`;

    const { rows } = await db.query(
        `SELECT p.id AS produto_id, p.nome, COALESCE(pl.visivel, false) AS visivel, pl.slug, pl.titulo, COALESCE(pl.ordem, 0) AS ordem, COALESCE(pl.carrossel_novidades, false) AS carrossel_novidades, COALESCE(pl.destaque_home, false) AS destaque_home,
                preco.preco_venda AS preco_online, COALESCE(el.saldo, 0) AS saldo_central,
                (SELECT COUNT(*)::int FROM produto_imagens i WHERE i.produto_id = p.id AND i.empresa_id = p.empresa_id) AS fotos
         ${base}
         ORDER BY COALESCE(pl.visivel, false) DESC, COALESCE(pl.ordem, 0), p.nome, p.id
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
    );
    const { rows: [{ total }] } = await db.query(`SELECT COUNT(*)::int AS total ${base}`, params);

    return {
        itens: rows.map((r) => {
            const preco = r.preco_online === null ? null : Number(r.preco_online);
            const temPreco = preco !== null && preco > 0;

            return {
                produto_id: r.produto_id,
                nome: r.nome,
                visivel: r.visivel,
                slug: r.slug,
                titulo: r.titulo,
                ordem: r.ordem,
                carrossel_novidades: r.carrossel_novidades,
                destaque_home: r.destaque_home,
                preco_online: temPreco ? preco : null,
                saldo_central: Number(r.saldo_central),
                fotos: r.fotos,
                // A loja só mostra a peça marcada que tem preço no canal online; sem saldo aparece como indisponível.
                aparece_na_loja: r.visivel && temPreco
            };
        }),
        total
    };
}

// Copia do cadastro (descrição e material) para as peças JÁ marcadas na loja que ainda estão sem esse texto.
// Só preenche o que está vazio (NULL): nunca troca texto já escrito, não mexe em peça fora da loja e é por empresa.
async function preencherTextosDoCadastro(empresa_id) {
    const { rows } = await db.query(
        `UPDATE produtos_loja pl
            SET descricao = COALESCE(pl.descricao, NULLIF(LEFT(btrim(p.descricao), 4000), '')),
                materiais = COALESCE(pl.materiais, NULLIF(LEFT((
                    SELECT string_agg(c.nome, ', ' ORDER BY c.nome)
                      FROM produtos_categorias pc
                      JOIN categorias_produto c ON c.id = pc.categoria_id AND c.empresa_id = pc.empresa_id
                     WHERE pc.produto_id = p.id AND pc.empresa_id = p.empresa_id AND c.nivel = 2), 2000), '')),
                atualizado_em = NOW()
           FROM produtos p
          WHERE p.id = pl.produto_id AND p.empresa_id = pl.empresa_id
            AND pl.empresa_id = $1 AND pl.visivel = true AND p.ativo = true AND p.tipo = 'acabado'
            AND (
                (pl.descricao IS NULL AND NULLIF(btrim(p.descricao), '') IS NOT NULL)
                OR (pl.materiais IS NULL AND EXISTS (
                    SELECT 1 FROM produtos_categorias pc
                      JOIN categorias_produto c ON c.id = pc.categoria_id AND c.empresa_id = pc.empresa_id
                     WHERE pc.produto_id = p.id AND pc.empresa_id = p.empresa_id AND c.nivel = 2))
            )
        RETURNING pl.produto_id`,
        [empresa_id]
    );

    return { atualizados: rows.length };
}

module.exports = { listarPedidos, marcarEntregaCombinada, listarParaAvisos, listarProdutosDaLoja, preencherTextosDoCadastro, SITUACOES };
