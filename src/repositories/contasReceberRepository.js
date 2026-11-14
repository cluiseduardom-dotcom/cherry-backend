const db = require('../config/db');
const AppError = require('../errors/AppError');
const { SQL_HOJE_SP } = require('../utils/dataSaoPaulo');
const { executarComLock, transicionarStatus } = require('./shared/transacoes');

// Quanto já entrou e quanto falta. Conta do fluxo novo (com parcela): vem da parcela (`valor_pago`, que só cresce por
// recebimentos registrados). Conta legada (sem parcela): recebida = tudo, pendente = nada. Cancelada não tem restante.
const JUNCAO_PARCELA = 'LEFT JOIN parcelas_pagamento pp ON pp.id = cr.parcela_id AND pp.empresa_id = cr.empresa_id';
const COLUNAS_COM_RECEBIMENTO = `cr.*,
        (CASE WHEN cr.parcela_id IS NOT NULL THEN COALESCE(pp.valor_pago, 0)
              WHEN cr.status = 'recebido' THEN cr.valor ELSE 0 END)::numeric(15, 2) AS valor_recebido,
        (CASE WHEN cr.status = 'cancelado' THEN 0
              WHEN cr.parcela_id IS NOT NULL THEN GREATEST(cr.valor - COALESCE(pp.valor_pago, 0), 0)
              WHEN cr.status = 'recebido' THEN 0 ELSE cr.valor END)::numeric(15, 2) AS valor_restante,
        COALESCE(pp.status = 'parcial', false) AS parcial`;

async function listarPaginado({ limit, offset, status, vencimentoDe, vencimentoAte, empresa_id }) {
    const condicoes = ['cr.empresa_id = $1'];
    const valores = [empresa_id];

    if (status !== undefined) {
        valores.push(status);
        condicoes.push(`cr.status = $${valores.length}`);
    }

    if (vencimentoDe !== undefined) {
        valores.push(vencimentoDe);
        condicoes.push(`cr.data_vencimento >= $${valores.length}`);
    }

    if (vencimentoAte !== undefined) {
        valores.push(vencimentoAte);
        condicoes.push(`cr.data_vencimento <= $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;

    const valoresListagem = [...valores, limit, offset];
    const { rows } = await db.query(
        `SELECT ${COLUNAS_COM_RECEBIMENTO}
         FROM contas_receber cr ${JUNCAO_PARCELA}
         ${where}
         ORDER BY cr.data_vencimento ASC, cr.id ASC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM contas_receber cr ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS_COM_RECEBIMENTO}
         FROM contas_receber cr ${JUNCAO_PARCELA}
         WHERE cr.id = $1 AND cr.empresa_id = $2`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

// Histórico de recebimentos de uma conta (parcela). Conta legada, sem parcela, não tem histórico detalhado.
async function listarRecebimentos(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT rc.id, rc.valor, rc.forma_pagamento, rc.data_recebimento, rc.observacao, u.nome AS recebido_por
           FROM contas_receber cr
           JOIN recebimentos_conta rc ON rc.parcela_id = cr.parcela_id AND rc.empresa_id = cr.empresa_id
           LEFT JOIN usuarios u ON u.id = rc.usuario_id AND u.empresa_id = rc.empresa_id
          WHERE cr.id = $1 AND cr.empresa_id = $2
          ORDER BY rc.data_recebimento ASC, rc.id ASC`,
        [id, empresa_id]
    );
    return rows;
}

// clienteExterno permite participar da transação de vendasRepository.criar
// (venda + itens + conta a receber viram uma única transação), no mesmo
// espírito de estoqueRepository.criarMovimentacao. Sem clienteExterno, abre e
// gerencia sua própria transação.
async function criar({ venda_id, descricao, valor, data_vencimento, empresa_id, parcela_id = null }, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;

    try {
        if (gerenciaTransacao) await client.query('BEGIN');

        const { rows } = await client.query(
            `INSERT INTO contas_receber (venda_id, parcela_id, descricao, valor, data_vencimento, empresa_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [venda_id, parcela_id, descricao, valor, data_vencimento, empresa_id]
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
    return executarComLock(
        'contas_receber',
        { coluna: 'venda_id', valor: venda_id },
        empresa_id,
        clienteExterno,
        async (linha, client) => {
            if (!linha) return null;

            // Compatibilidade com a unidade antiga: uma linha mockada sem
            // venda_id representa a conta única do modelo anterior.
            if (linha.venda_id == null) {
                if (linha.status === 'recebido') {
                    throw new AppError('Venda com conta a receber já recebida não pode ser cancelada', 409);
                }
                if (linha.status === 'cancelado') return linha;

                const { rows } = await client.query(
                    `UPDATE contas_receber
                     SET status = 'cancelado', atualizado_em = NOW()
                     WHERE id = $1 RETURNING *`,
                    [linha.id]
                );
                return rows[0];
            }

            const { rows: contas } = await client.query(
                `SELECT * FROM contas_receber
                 WHERE venda_id = $1 AND empresa_id = $2
                 FOR UPDATE`,
                [venda_id, empresa_id]
            );

            if (contas.some((conta) => conta.status === 'recebido')) {
                throw new AppError('Venda com conta a receber já recebida e não pode ser cancelada', 409);
            }

            // Recebimento PARCIAL: o dinheiro já entrou em parte; cancelar a venda por trás dele esconderia o recebimento.
            const parcelasDasContas = contas.map((conta) => conta.parcela_id).filter((p) => p !== null && p !== undefined);

            if (parcelasDasContas.length) {
                const { rows: parciais } = await client.query(
                    `SELECT 1 FROM parcelas_pagamento
                      WHERE id = ANY($1::int[]) AND empresa_id = $2 AND valor_pago > 0 LIMIT 1`,
                    [parcelasDasContas, empresa_id]
                );

                if (parciais.length) {
                    throw new AppError('Venda com recebimento parcial não pode ser cancelada: o dinheiro já entrou em parte', 409);
                }
            }

            const pendentes = contas.filter((conta) => conta.status === 'pendente');
            if (!pendentes.length) return contas[0] ?? null;

            const { rows } = await client.query(
                `UPDATE contas_receber
                 SET status = 'cancelado', atualizado_em = NOW()
                 WHERE venda_id = $1 AND empresa_id = $2 AND status = 'pendente'
                 RETURNING *`,
                [venda_id, empresa_id]
            );

            return rows.length === 1 ? rows[0] : rows;
        }
    );
}

async function buscarPorParcelaId(parcela_id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM contas_receber WHERE parcela_id = $1 AND empresa_id = $2',
        [parcela_id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function atualizarRecebimento(id, { status, data_recebimento }, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE contas_receber
         SET status = $1, data_recebimento = $2, atualizado_em = NOW()
         WHERE id = $3 AND empresa_id = $4
         RETURNING *`,
        [status, data_recebimento, id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function marcarComoRecebida(id, empresa_id) {
    return transicionarStatus('contas_receber', id, empresa_id, {
        statusEsperado: 'pendente',
        mensagemNaoEncontrado: 'Conta a receber não encontrada',
        mensagemStatusInvalido: 'Somente contas pendentes podem ser marcadas como recebidas',
        sets: `status = 'recebido', data_recebimento = ${SQL_HOJE_SP}`
    });
}

module.exports = {
    listarPaginado,
    buscarPorId,
    listarRecebimentos,
    criar,
    cancelarPorVendaId,
    buscarPorParcelaId,
    atualizarRecebimento,
    marcarComoRecebida
};
