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
    const [{ rows: aCombinar }, { rows: semVenda }] = await Promise.all([
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
        )
    ]);

    return { aCombinar, semVenda };
}

module.exports = { listarPedidos, marcarEntregaCombinada, listarParaAvisos, SITUACOES };
