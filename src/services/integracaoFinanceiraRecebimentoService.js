const AppError = require('../errors/AppError');
const contasPagarRepository = require('../repositories/contasPagarRepository');

async function criarObrigacao(recebimentoId, usuario, client) {
    const empresaId = usuario.empresa_id;

    const existente = await contasPagarRepository.buscarPorRecebimentoId(
        recebimentoId,
        empresaId,
        client
    );

    if (existente) {
        return { conta_pagar: existente, idempotente: true };
    }

    const { rows: cabecalhoRows } = await client.query(
        `SELECT
            r.id,
            r.empresa_id,
            r.data_recebimento,
            r.numero_nf,
            r.numero AS numero_recebimento,
            r.pedido_compra_id,
            pc.numero AS numero_pedido,
            pc.prazo_pagamento_dias,
            f.nome AS fornecedor_nome
         FROM recebimentos r
         JOIN pedidos_compra pc
           ON pc.id = r.pedido_compra_id
          AND pc.empresa_id = r.empresa_id
         JOIN fornecedores f
           ON f.id = r.fornecedor_id
          AND f.empresa_id = r.empresa_id
         WHERE r.id = $1
           AND r.empresa_id = $2
         FOR UPDATE`,
        [recebimentoId, empresaId]
    );

    if (!cabecalhoRows.length) {
        throw new AppError('Recebimento não encontrado', 404);
    }

    const recebimento = cabecalhoRows[0];

    const { rows: itensRows } = await client.query(
        `SELECT
            COALESCE(SUM(quantidade_recebida * preco_unitario), 0) AS valor_total
         FROM recebimentos_itens
         WHERE recebimento_id = $1
           AND empresa_id = $2`,
        [recebimentoId, empresaId]
    );

    const valor = Number(Number(itensRows[0].valor_total || 0).toFixed(2));

    if (valor <= 0) {
        return { conta_pagar: null, idempotente: false, sem_obrigacao: true };
    }

    const { rows: contaRows } = await client.query(
        `SELECT id
         FROM contas_pagar
         WHERE recebimento_id = $1
           AND empresa_id = $2
         FOR UPDATE`,
        [recebimentoId, empresaId]
    );

    if (contaRows.length) {
        return {
            conta_pagar: await contasPagarRepository.buscarPorRecebimentoId(
                recebimentoId,
                empresaId,
                client
            ),
            idempotente: true
        };
    }

    const prazo = Number(recebimento.prazo_pagamento_dias || 0);

    const conta = await contasPagarRepository.criar({
        descricao: recebimento.numero_nf
            ? `NF-e ${recebimento.numero_nf} - PC ${recebimento.numero_pedido}`
            : `Recebimento ${recebimento.numero_recebimento} - PC ${recebimento.numero_pedido}`,
        fornecedor: recebimento.fornecedor_nome,
        valor,
        data_vencimento: null,
        categoria: 'COMPRAS',
        observacao: `Gerada pelo recebimento #${recebimento.id}`,
        usuario_id: usuario.id,
        empresa_id: empresaId,
        recebimento_id: recebimento.id
    }, client);

    const { rows: contaAtualizadaRows } = await client.query(
        `UPDATE contas_pagar
         SET data_vencimento = $1,
             atualizado_em = NOW()
         WHERE id = $2
           AND empresa_id = $3
         RETURNING *`,
        [prazo, conta.id, empresaId]
    );

    // A coluna data_vencimento é DATE. O vencimento é derivado da data
    // efetiva do recebimento + prazo negociado no PC.
    const { rows: vencimentoRows } = await client.query(
        `UPDATE contas_pagar
         SET data_vencimento = (
             SELECT r.data_recebimento + COALESCE(pc.prazo_pagamento_dias, 0)
             FROM recebimentos r
             JOIN pedidos_compra pc
               ON pc.id = r.pedido_compra_id
              AND pc.empresa_id = r.empresa_id
             WHERE r.id = $1
               AND r.empresa_id = $2
         ),
         atualizado_em = NOW()
         WHERE id = $3
           AND empresa_id = $2
         RETURNING *`,
        [recebimentoId, empresaId, conta.id]
    );

    if (!vencimentoRows.length) {
        throw new AppError('Não foi possível definir o vencimento da conta a pagar', 500);
    }

    return {
        conta_pagar: vencimentoRows[0],
        idempotente: false,
        sem_obrigacao: false
    };
}

module.exports = { criarObrigacao };
