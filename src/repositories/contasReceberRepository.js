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
// pendente. Se já tiver sido recebida, o dinheiro já entrou: bloqueia o
// cancelamento (409), mesmo padrão de contasPagarRepository.atualizar
// bloqueando edição de conta paga/cancelada — quem chama (vendasRepository.
// cancelar) deixa esse erro estourar antes de tocar em estoque ou no status
// da venda, então nada fica parcialmente cancelado. Se a venda era à vista e
// nunca gerou conta, é um no-op silencioso. Usa executarComLock direto (não
// transicionarStatus) porque a ramificação é irregular: sem linha vinculada
// → no-op, já cancelada → devolve como está, sem UPDATE nem erro.
// clienteExterno participa da transação de vendasRepository.cancelar, mesmo
// padrão de criar().
async function cancelarPorVendaId(venda_id, empresa_id, clienteExterno) {
    return executarComLock('contas_receber', { coluna: 'venda_id', valor: venda_id }, empresa_id, clienteExterno, async (conta, client) => {
        if (!conta) {
            return null;
        }

        if (conta.status === 'recebido') {
            throw new AppError('Venda com conta a receber já recebida não pode ser cancelada', 409);
        }

        if (conta.status !== 'pendente') {
            return conta;
        }

        const { rows } = await client.query(
            `UPDATE contas_receber SET status = 'cancelado', atualizado_em = NOW() WHERE id = $1 RETURNING *`,
            [conta.id]
        );

        return rows[0];
    });
}

async function marcarComoRecebida(id, empresa_id) {
    return transicionarStatus('contas_receber', id, empresa_id, {
        statusEsperado: 'pendente',
        mensagemNaoEncontrado: 'Conta a receber não encontrada',
        mensagemStatusInvalido: 'Somente contas pendentes podem ser marcadas como recebidas',
        sets: `status = 'recebido', data_recebimento = CURRENT_DATE`
    });
}

module.exports = {
    listarPaginado,
    buscarPorId,
    criar,
    cancelarPorVendaId,
    marcarComoRecebida
};
