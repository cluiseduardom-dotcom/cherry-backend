const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock, transicionarStatus } = require('./shared/transacoes');

async function listarPaginado({ limit, offset, status, vencimentoDe, vencimentoAte, empresa_id }) {
    const condicoes = ['empresa_id = $1'];
    const valores = [empresa_id];

    if (status !== undefined) {
        valores.push(status);
        condicoes.push(`status = $${valores.length}`);
    }

    if (vencimentoDe !== undefined) {
        valores.push(vencimentoDe);
        condicoes.push(`data_vencimento >= $${valores.length}`);
    }

    if (vencimentoAte !== undefined) {
        valores.push(vencimentoAte);
        condicoes.push(`data_vencimento <= $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;

    const valoresListagem = [...valores, limit, offset];
    const { rows } = await db.query(
        `SELECT * FROM contas_pagar
         ${where}
         ORDER BY data_vencimento ASC, id ASC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM contas_pagar ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        'SELECT * FROM contas_pagar WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function criar({ descricao, fornecedor, valor, data_vencimento, categoria, observacao, usuario_id, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO contas_pagar (descricao, fornecedor, valor, data_vencimento, categoria, observacao, usuario_id, empresa_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
            descricao,
            fornecedor ?? null,
            valor,
            data_vencimento,
            categoria ?? null,
            observacao ?? null,
            usuario_id,
            empresa_id
        ]
    );

    return rows[0];
}

// Lock de linha (FOR UPDATE) via executarComLock, mesmo motivo do lock em
// marcarComoPaga/cancelar: impede que um PUT concorrente com um PATCH
// /:id/pagar (ou /cancelar) passem ambos pela checagem de status antes de
// qualquer um gravar. Não usa transicionarStatus porque o SET é dinâmico
// (monta a partir dos campos informados), não uma string fixa.
async function atualizar(id, dados, empresa_id) {
    const campos = ['descricao', 'fornecedor', 'valor', 'data_vencimento', 'categoria', 'observacao'];

    return executarComLock('contas_pagar', { coluna: 'id', valor: id }, empresa_id, undefined, async (conta, client) => {
        if (!conta) {
            throw new AppError('Conta a pagar não encontrada', 404);
        }

        if (conta.status !== 'pendente') {
            throw new AppError('Contas pagas ou canceladas não podem ser editadas', 409);
        }

        const sets = ['atualizado_em = NOW()'];
        const valores = [];
        let i = 1;

        for (const campo of campos) {
            if (dados[campo] !== undefined) {
                sets.push(`${campo} = $${i}`);
                valores.push(dados[campo]);
                i++;
            }
        }

        valores.push(id);

        const { rows } = await client.query(
            `UPDATE contas_pagar SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
            valores
        );

        return rows[0];
    });
}

async function marcarComoPaga(id, empresa_id) {
    return transicionarStatus('contas_pagar', id, empresa_id, {
        statusEsperado: 'pendente',
        mensagemNaoEncontrado: 'Conta a pagar não encontrada',
        mensagemStatusInvalido: 'Somente contas pendentes podem ser marcadas como pagas',
        sets: `status = 'pago', data_pagamento = CURRENT_DATE`
    });
}

async function cancelar(id, empresa_id) {
    return transicionarStatus('contas_pagar', id, empresa_id, {
        statusEsperado: 'pendente',
        mensagemNaoEncontrado: 'Conta a pagar não encontrada',
        mensagemStatusInvalido: 'Somente contas pendentes podem ser canceladas',
        sets: `status = 'cancelado'`
    });
}

module.exports = {
    listarPaginado,
    buscarPorId,
    criar,
    atualizar,
    marcarComoPaga,
    cancelar
};
