const db = require('../config/db');
const AppError = require('../errors/AppError');

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

// Lock de linha (FOR UPDATE), mesmo motivo de transicionarStatus: impede que
// um PUT concorrente com um PATCH /:id/pagar (ou /cancelar) passem ambos pela
// checagem de status antes de qualquer um gravar.
async function atualizar(id, dados, empresa_id) {
    const campos = ['descricao', 'fornecedor', 'valor', 'data_vencimento', 'categoria', 'observacao'];
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: contaRows } = await client.query(
            'SELECT * FROM contas_pagar WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
            [id, empresa_id]
        );

        if (!contaRows.length) {
            throw new AppError('Conta a pagar não encontrada', 404);
        }

        if (contaRows[0].status !== 'pendente') {
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

        await client.query('COMMIT');

        return rows[0];

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Lock de linha (FOR UPDATE) dentro de uma transação, no mesmo espírito de
// vendasRepository.cancelar: evita que duas requisições concorrentes (ex:
// dois cliques em "marcar como paga") passem ambas pela checagem de status
// antes de qualquer uma delas gravar a mudança.
async function transicionarStatus(id, empresa_id, { statusEsperado, mensagemStatusInvalido, sets }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: contaRows } = await client.query(
            'SELECT * FROM contas_pagar WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
            [id, empresa_id]
        );

        if (!contaRows.length) {
            throw new AppError('Conta a pagar não encontrada', 404);
        }

        if (contaRows[0].status !== statusEsperado) {
            throw new AppError(mensagemStatusInvalido, 409);
        }

        const { rows: atualizadaRows } = await client.query(
            `UPDATE contas_pagar SET ${sets}, atualizado_em = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );

        await client.query('COMMIT');

        return atualizadaRows[0];

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function marcarComoPaga(id, empresa_id) {
    return transicionarStatus(id, empresa_id, {
        statusEsperado: 'pendente',
        mensagemStatusInvalido: 'Somente contas pendentes podem ser marcadas como pagas',
        sets: `status = 'pago', data_pagamento = CURRENT_DATE`
    });
}

async function cancelar(id, empresa_id) {
    return transicionarStatus(id, empresa_id, {
        statusEsperado: 'pendente',
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
