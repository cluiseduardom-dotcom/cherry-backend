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
        `SELECT * FROM contas_receber
         ${where}
         ORDER BY data_vencimento ASC, id ASC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM contas_receber ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        'SELECT * FROM contas_receber WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

// clienteExterno permite participar da transação de vendasRepository.criar
// (venda + itens + conta a receber viram uma única transação), no mesmo
// espírito de estoqueRepository.criarMovimentacao. Sem clienteExterno, abre e
// gerencia sua própria transação.
async function criar({ venda_id, descricao, valor, data_vencimento, empresa_id }, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;

    try {
        if (gerenciaTransacao) await client.query('BEGIN');

        const { rows } = await client.query(
            `INSERT INTO contas_receber (venda_id, descricao, valor, data_vencimento, empresa_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [venda_id, descricao, valor, data_vencimento, empresa_id]
        );

        if (gerenciaTransacao) await client.query('COMMIT');

        return rows[0];

    } catch (error) {
        if (gerenciaTransacao) await client.query('ROLLBACK');
        throw error;
    } finally {
        if (gerenciaTransacao) client.release();
    }
}

// Cancela a conta a receber vinculada a uma venda, só se ainda estiver
// pendente — se já tiver sido recebida, o dinheiro já entrou e a conta não é
// mexida (mesma decisão de negócio de vendasRepository.cancelar). Se a venda
// era à vista e nunca gerou conta, é um no-op silencioso. clienteExterno
// participa da transação de vendasRepository.cancelar, mesmo padrão de criar().
async function cancelarPorVendaId(venda_id, empresa_id, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;

    try {
        if (gerenciaTransacao) await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT * FROM contas_receber WHERE venda_id = $1 AND empresa_id = $2 FOR UPDATE',
            [venda_id, empresa_id]
        );

        let resultado = null;

        if (rows.length && rows[0].status === 'pendente') {
            const { rows: atualizadaRows } = await client.query(
                `UPDATE contas_receber SET status = 'cancelado', atualizado_em = NOW() WHERE id = $1 RETURNING *`,
                [rows[0].id]
            );
            resultado = atualizadaRows[0];
        } else if (rows.length) {
            resultado = rows[0];
        }

        if (gerenciaTransacao) await client.query('COMMIT');

        return resultado;

    } catch (error) {
        if (gerenciaTransacao) await client.query('ROLLBACK');
        throw error;
    } finally {
        if (gerenciaTransacao) client.release();
    }
}

// Lock de linha (FOR UPDATE), mesmo motivo de contasPagarRepository.marcarComoPaga:
// impede que duas requisições concorrentes marquem a mesma conta como recebida.
async function marcarComoRecebida(id, empresa_id) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: contaRows } = await client.query(
            'SELECT * FROM contas_receber WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
            [id, empresa_id]
        );

        if (!contaRows.length) {
            throw new AppError('Conta a receber não encontrada', 404);
        }

        if (contaRows[0].status !== 'pendente') {
            throw new AppError('Somente contas pendentes podem ser marcadas como recebidas', 409);
        }

        const { rows: atualizadaRows } = await client.query(
            `UPDATE contas_receber SET status = 'recebido', data_recebimento = CURRENT_DATE, atualizado_em = NOW()
             WHERE id = $1 RETURNING *`,
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

module.exports = {
    listarPaginado,
    buscarPorId,
    criar,
    cancelarPorVendaId,
    marcarComoRecebida
};
