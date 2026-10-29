const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');

// Devolução de Pix. Toda leitura/escrita filtra por empresa_id na própria query.

const LIMITE_PADRAO = 50;

// Devolução ativa (pedida ou concluída) de uma cobrança: impede devolver duas vezes e impede que uma venda
// consuma um Pix que está sendo devolvido.
async function buscarAtiva(cobranca_id, empresa_id, executor = db) {
    const { rows } = await executor.query(
        `SELECT id, status FROM cobranca_devolucoes
         WHERE cobranca_id = $1 AND empresa_id = $2 AND status IN ('solicitada', 'concluida')`,
        [cobranca_id, empresa_id]
    );

    return rows[0] ?? null;
}

// Trava a cobrança e confere, sob a trava, tudo o que autoriza devolver: Pix pago, sem devolução ativa e
// fora de venda ativa (sem venda, ou venda cancelada). Grava o pedido ('solicitada') na MESMA transação,
// então uma venda concorrente não consegue consumir o Pix depois (consumirParaVenda enxerga a devolução).
async function reservar({ empresa_id, codigo, motivo, solicitado_por }) {
    return executarComLock('cobrancas_pagamento', { coluna: 'codigo', valor: codigo }, empresa_id, undefined, async (cobranca, client) => {
        if (!cobranca) {
            throw new AppError('Cobrança Pix não encontrada', 404);
        }

        if (cobranca.status === 'estornado') {
            throw new AppError('Este Pix já foi devolvido.', 409);
        }

        if (cobranca.status !== 'pago') {
            throw new AppError('Só é possível devolver um Pix que foi pago.', 409);
        }

        if (cobranca.venda_id !== null) {
            const { rows } = await client.query(
                'SELECT status FROM vendas WHERE id = $1 AND empresa_id = $2',
                [cobranca.venda_id, empresa_id]
            );

            if (rows[0]?.status !== 'cancelada') {
                throw new AppError('Este Pix pertence a uma venda ativa. Cancele a venda antes de devolver.', 409);
            }
        }

        if (await buscarAtiva(cobranca.id, empresa_id, client)) {
            throw new AppError('Este Pix já tem uma devolução em andamento ou concluída.', 409);
        }

        const { rows } = await client.query(
            `INSERT INTO cobranca_devolucoes (empresa_id, cobranca_id, valor, motivo, solicitado_por)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, cobranca_id, valor, status, motivo, solicitado_por, criado_em`,
            [empresa_id, cobranca.id, cobranca.valor, motivo, solicitado_por]
        );

        return { cobranca, devolucao: rows[0] };
    });
}

async function marcarConcluida({ id, empresa_id, idExterno }) {
    const { rows } = await db.query(
        `UPDATE cobranca_devolucoes SET status = 'concluida', id_externo = $3, erro = NULL, atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND status = 'solicitada'
         RETURNING id, cobranca_id, valor, status, motivo, criado_em`,
        [id, empresa_id, idExterno]
    );

    return rows[0] ?? null;
}

// A cobrança passou a 'estornado' (webhook/consulta ao provedor): a devolução pedida está concluída, mesmo
// que a resposta da nossa chamada tenha se perdido.
async function concluirPorCobranca(cobranca_id, empresa_id) {
    await db.query(
        `UPDATE cobranca_devolucoes SET status = 'concluida', erro = NULL, atualizado_em = NOW()
         WHERE cobranca_id = $1 AND empresa_id = $2 AND status = 'solicitada'`,
        [cobranca_id, empresa_id]
    );
}

async function marcarFalhou({ id, empresa_id, erro }) {
    await db.query(
        `UPDATE cobranca_devolucoes SET status = 'falhou', erro = $3, atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND status = 'solicitada'`,
        [id, empresa_id, String(erro).slice(0, 200)]
    );
}

// Pix pagos que podem ser devolvidos agora: sem venda, ou de venda cancelada, e sem devolução ativa.
// Nunca traz taxa da plataforma, id do provedor ou dados do pagador.
async function listarADevolver({ empresa_id, limit = LIMITE_PADRAO, offset = 0 }) {
    const filtro = `c.empresa_id = $1 AND c.status = 'pago'
                    AND (c.venda_id IS NULL OR v.status = 'cancelada')
                    AND NOT EXISTS (
                        SELECT 1 FROM cobranca_devolucoes d
                         WHERE d.cobranca_id = c.id AND d.empresa_id = c.empresa_id AND d.status IN ('solicitada', 'concluida')
                    )`;

    const { rows } = await db.query(
        `SELECT c.codigo, c.valor, c.criado_em, c.venda_id,
                CASE WHEN c.venda_id IS NULL THEN 'sem_venda' ELSE 'venda_cancelada' END AS situacao
         FROM cobrancas_pagamento c
         LEFT JOIN vendas v ON v.id = c.venda_id AND v.empresa_id = c.empresa_id
         WHERE ${filtro}
         ORDER BY c.criado_em DESC, c.id DESC
         LIMIT $2 OFFSET $3`,
        [empresa_id, limit, offset]
    );

    const { rows: [total] } = await db.query(
        `SELECT COUNT(*)::int AS quantidade, COALESCE(SUM(c.valor), 0) AS valor_total
         FROM cobrancas_pagamento c
         LEFT JOIN vendas v ON v.id = c.venda_id AND v.empresa_id = c.empresa_id
         WHERE ${filtro}`,
        [empresa_id]
    );

    return { items: rows, total: total.quantidade, valor_total: total.valor_total };
}

async function listarDevolucoes({ empresa_id, limit = LIMITE_PADRAO, offset = 0 }) {
    const { rows } = await db.query(
        `SELECT d.id, c.codigo AS cobranca_codigo, d.valor, d.status, d.motivo, d.erro,
                d.solicitado_por, u.nome AS solicitado_por_nome, d.criado_em, d.atualizado_em
         FROM cobranca_devolucoes d
         JOIN cobrancas_pagamento c ON c.id = d.cobranca_id AND c.empresa_id = d.empresa_id
         JOIN usuarios u ON u.id = d.solicitado_por AND u.empresa_id = d.empresa_id
         WHERE d.empresa_id = $1
         ORDER BY d.id DESC
         LIMIT $2 OFFSET $3`,
        [empresa_id, limit, offset]
    );

    const { rows: [total] } = await db.query(
        'SELECT COUNT(*)::int AS quantidade FROM cobranca_devolucoes WHERE empresa_id = $1',
        [empresa_id]
    );

    return { items: rows, total: total.quantidade };
}

module.exports = { buscarAtiva, reservar, marcarConcluida, concluirPorCobranca, marcarFalhou, listarADevolver, listarDevolucoes };
