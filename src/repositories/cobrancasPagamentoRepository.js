const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');
const { reaisParaCentavos } = require('../utils/taxaPlataforma');

const COLUNAS = `id, codigo, empresa_id, provedor, metodo, valor, taxa_plataforma, status, id_externo,
                 qr_code, qr_code_base64, ticket_url, expira_em, venda_id, usada_em, consultado_em, criado_em, atualizado_em,
                 preferencia_id, link_url, tipo_cartao, parcelas, parcelas_maximas`;

async function criar({ codigo, empresa_id, valor, taxa_plataforma, criado_por, metodo = 'pix', parcelas_maximas = null }) {
    const { rows } = await db.query(
        `INSERT INTO cobrancas_pagamento (codigo, empresa_id, valor, taxa_plataforma, criado_por, metodo, parcelas_maximas)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${COLUNAS}`,
        [codigo, empresa_id, valor, taxa_plataforma, criado_por, metodo, parcelas_maximas]
    );

    return rows[0];
}

async function registrarCriadaNoProvedor({ id, empresa_id, idExterno, qrCode, qrCodeBase64, ticketUrl, expiraEm, status }) {
    const { rows } = await db.query(
        `UPDATE cobrancas_pagamento
         SET id_externo = $3, qr_code = $4, qr_code_base64 = $5, ticket_url = $6, expira_em = $7, status = $8, atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2
         RETURNING ${COLUNAS}`,
        [id, empresa_id, idExterno, qrCode, qrCodeBase64, ticketUrl, expiraEm, status]
    );

    return rows[0];
}

// Link de cartão criado no provedor: ainda não há pagamento (id_externo só existe depois que o cliente paga).
async function registrarLinkCriado({ id, empresa_id, preferenciaId, linkUrl, expiraEm }) {
    const { rows } = await db.query(
        `UPDATE cobrancas_pagamento
         SET preferencia_id = $3, link_url = $4, expira_em = $5, atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND metodo = 'cartao_link' AND status = 'pendente'
         RETURNING ${COLUNAS}`,
        [id, empresa_id, preferenciaId, linkUrl, expiraEm]
    );

    return rows[0];
}

// Grava o pagamento de cartão encontrado no provedor (id, tipo e parcelas vêm do Mercado Pago, não do PDV).
// Só enquanto a cobrança ainda não tem pagamento associado: o primeiro vence e não é trocado depois.
async function registrarPagamentoCartao({ id, empresa_id, idExterno, tipoCartao, parcelas }) {
    const { rows } = await db.query(
        `UPDATE cobrancas_pagamento
         SET id_externo = $3, tipo_cartao = $4, parcelas = $5, atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND metodo = 'cartao_link' AND id_externo IS NULL
         RETURNING ${COLUNAS}`,
        [id, empresa_id, idExterno, tipoCartao, parcelas]
    );

    return rows[0] ?? null;
}

async function marcarFalhou(id, empresa_id) {
    await db.query(
        `UPDATE cobrancas_pagamento SET status = 'falhou', atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND status = 'pendente'`,
        [id, empresa_id]
    );
}

// Sempre filtra por empresa_id: o código sozinho nunca é fronteira de segurança.
async function buscarPorCodigo(codigo, empresa_id) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS} FROM cobrancas_pagamento WHERE codigo = $1 AND empresa_id = $2`,
        [codigo, empresa_id]
    );

    return rows[0] ?? null;
}

// Só para o webhook: o id do provedor identifica a cobrança (e portanto a empresa) de forma única.
async function buscarPorIdExterno(idExterno) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS} FROM cobrancas_pagamento WHERE provedor = 'mercadopago' AND id_externo = $1`,
        [String(idExterno)]
    );

    return rows[0] ?? null;
}

// Troca de status otimista: só aplica se ninguém mudou a linha no meio do caminho.
async function atualizarStatus({ id, empresa_id, de, para }) {
    const { rows } = await db.query(
        `UPDATE cobrancas_pagamento
         SET status = $4, consultado_em = NOW(), atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND status = $3
         RETURNING ${COLUNAS}`,
        [id, empresa_id, de, para]
    );

    return rows[0] ?? null;
}

async function registrarConsulta(id, empresa_id) {
    await db.query(
        `UPDATE cobrancas_pagamento SET consultado_em = NOW() WHERE id = $1 AND empresa_id = $2`,
        [id, empresa_id]
    );
}

// Consome a cobrança paga numa venda, DENTRO da transação da venda (client dela): trava a linha,
// confere empresa (pelo filtro do lock), status pago, valor idêntico e que ainda não foi usada.
// Uma cobrança só entra em uma venda; qualquer divergência derruba a venda inteira (ROLLBACK).
async function consumirParaVenda({ codigo, empresa_id, venda_id, valor, forma_pagamento, numero_parcelas }, client) {
    return executarComLock('cobrancas_pagamento', { coluna: 'codigo', valor: codigo }, empresa_id, client, async (cobranca, tx) => {
        if (!cobranca) {
            throw new AppError('Cobrança não encontrada', 404);
        }

        const rotulo = cobranca.metodo === 'pix' ? 'Pix' : 'link de cartão';

        if (cobranca.venda_id !== null) {
            throw new AppError(`Esta cobrança (${rotulo}) já foi usada em outra venda`, 409);
        }

        if (cobranca.status !== 'pago') {
            throw new AppError(`O pagamento (${rotulo}) ainda não foi confirmado pelo Mercado Pago`, 409);
        }

        if (reaisParaCentavos(cobranca.valor) !== reaisParaCentavos(valor)) {
            throw new AppError(`O valor do pagamento não confere com a cobrança (${rotulo})`, 400);
        }

        // A forma de pagamento da venda tem de ser a que o Mercado Pago confirmou: o PDV não escolhe.
        if (cobranca.metodo === 'pix' && forma_pagamento !== 'pix') {
            throw new AppError('Cobrança Pix só vale como pagamento Pix', 400);
        }

        if (cobranca.metodo === 'cartao_link') {
            if (!cobranca.tipo_cartao || forma_pagamento !== cobranca.tipo_cartao) {
                throw new AppError('A forma de pagamento não confere com o cartão usado no link', 400);
            }

            if (cobranca.tipo_cartao === 'credito' && (numero_parcelas ?? 1) !== cobranca.parcelas) {
                throw new AppError('O número de parcelas não confere com o pagamento no link', 400);
            }

            if (cobranca.tipo_cartao === 'debito' && (numero_parcelas ?? 1) !== 1) {
                throw new AppError('Débito não é parcelado', 400);
            }
        }

        // Pix que está sendo devolvido (ou já devolvido) não entra em venda. A devolução é gravada sob a
        // mesma trava desta linha, então não há corrida entre as duas operações.
        const { rows: devolucoes } = await tx.query(
            `SELECT 1 FROM cobranca_devolucoes
             WHERE cobranca_id = $1 AND empresa_id = $2 AND status IN ('solicitada', 'concluida')`,
            [cobranca.id, empresa_id]
        );

        if (devolucoes.length > 0) {
            throw new AppError('Este pagamento está sendo devolvido e não pode entrar em uma venda', 409);
        }

        const { rows } = await tx.query(
            `UPDATE cobrancas_pagamento SET venda_id = $1, usada_em = NOW(), atualizado_em = NOW()
             WHERE id = $2 AND empresa_id = $3
             RETURNING ${COLUNAS}`,
            [venda_id, cobranca.id, empresa_id]
        );

        return rows[0];
    });
}

async function buscarEmailContatoEmpresa(empresa_id) {
    const { rows } = await db.query('SELECT email_contato FROM empresas WHERE id = $1', [empresa_id]);

    return rows[0]?.email_contato ?? null;
}

module.exports = {
    criar,
    registrarCriadaNoProvedor,
    registrarLinkCriado,
    registrarPagamentoCartao,
    marcarFalhou,
    buscarPorCodigo,
    buscarPorIdExterno,
    atualizarStatus,
    registrarConsulta,
    consumirParaVenda,
    buscarEmailContatoEmpresa
};
