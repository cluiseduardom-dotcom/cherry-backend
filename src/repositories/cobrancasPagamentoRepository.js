const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');
const { reaisParaCentavos } = require('../utils/taxaPlataforma');

const COLUNAS = `id, codigo, empresa_id, provedor, metodo, valor, taxa_plataforma, status, id_externo,
                 qr_code, qr_code_base64, ticket_url, expira_em, venda_id, usada_em, consultado_em, criado_em, atualizado_em`;

async function criar({ codigo, empresa_id, valor, taxa_plataforma, criado_por }) {
    const { rows } = await db.query(
        `INSERT INTO cobrancas_pagamento (codigo, empresa_id, valor, taxa_plataforma, criado_por)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLUNAS}`,
        [codigo, empresa_id, valor, taxa_plataforma, criado_por]
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
async function consumirParaVenda({ codigo, empresa_id, venda_id, valor }, client) {
    return executarComLock('cobrancas_pagamento', { coluna: 'codigo', valor: codigo }, empresa_id, client, async (cobranca, tx) => {
        if (!cobranca) {
            throw new AppError('Cobrança Pix não encontrada', 404);
        }

        if (cobranca.venda_id !== null) {
            throw new AppError('Esta cobrança Pix já foi usada em outra venda', 409);
        }

        if (cobranca.status !== 'pago') {
            throw new AppError('O Pix ainda não foi confirmado pelo Mercado Pago', 409);
        }

        if (reaisParaCentavos(cobranca.valor) !== reaisParaCentavos(valor)) {
            throw new AppError('O valor do pagamento não confere com a cobrança Pix', 400);
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
    marcarFalhou,
    buscarPorCodigo,
    buscarPorIdExterno,
    atualizarStatus,
    registrarConsulta,
    consumirParaVenda,
    buscarEmailContatoEmpresa
};
