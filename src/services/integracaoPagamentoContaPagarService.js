const db = require('../config/db');
const AppError = require('../errors/AppError');
const transacoesPagamentoRepository = require('../repositories/transacoesPagamentoRepository');
const liquidacoesPagamentoRepository = require('../repositories/liquidacoesPagamentoRepository');

const FORMAS = new Set(['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'BOLETO', 'TRANSFERENCIA', 'OUTRO']);
const ORIGENS = new Set(['MANUAL', 'GATEWAY', 'TEF', 'OPEN_FINANCE', 'API_BANCO']);

async function pagar(contaId, dados = {}, usuario) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM contas_pagar WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [contaId, usuario.empresa_id]);
    if (!rows.length) throw new AppError('Conta a pagar não encontrada', 404);
    const conta = rows[0];
    if (conta.status !== 'pendente') throw new AppError('Somente contas pendentes podem ser marcadas como pagas', 409);
    if (conta.transacao_pagamento_id) throw new AppError('Conta a pagar já possui transação de pagamento', 409);

    const formaPagamento = dados.forma_pagamento ?? 'PIX';
    const origem = dados.origem ?? 'MANUAL';
    const taxa = Number(dados.taxa ?? 0);
    const valor = Number(conta.valor);
    if (!FORMAS.has(formaPagamento)) throw new AppError('Forma de pagamento inválida', 400);
    if (!ORIGENS.has(origem)) throw new AppError('Origem do pagamento inválida', 400);
    if (!Number.isFinite(taxa) || taxa < 0 || taxa > valor) throw new AppError('Taxa de pagamento inválida', 400);

    const transacao = await transacoesPagamentoRepository.criar({
      empresa_id: usuario.empresa_id, tipo: 'PAGAMENTO', forma_pagamento: formaPagamento, origem,
      provedor: dados.provedor ?? null, valor, taxa, valor_liquido: Number((valor - taxa).toFixed(2)),
      status: 'CONFIRMADA', transacao_externa_id: dados.transacao_externa_id ?? null,
      autorizacao: dados.autorizacao ?? null, nsu: dados.nsu ?? null, tid: dados.tid ?? null,
      data_autorizacao: dados.data_autorizacao ?? new Date(), data_confirmacao: new Date(),
      observacao: dados.observacao ?? null, usuario_id: usuario.id
    }, client);

    const liquidacao = await liquidacoesPagamentoRepository.criar({
      empresa_id: usuario.empresa_id, transacao_pagamento_id: transacao.id, tipo: 'PAGAMENTO',
      valor_bruto: valor, taxa, valor_liquido: Number((valor - taxa).toFixed(2)),
      data_prevista: conta.data_vencimento, referencia_externa: dados.transacao_externa_id ?? null,
      observacao: dados.observacao ?? null, usuario_id: usuario.id
    }, client);

    const { rows: atualizadas } = await client.query(
      "UPDATE contas_pagar SET status = 'pago', data_pagamento = CURRENT_DATE, transacao_pagamento_id = $1, atualizado_em = NOW() WHERE id = $2 AND empresa_id = $3 RETURNING *",
      [transacao.id, contaId, usuario.empresa_id]
    );
    const { rows: liquidada } = await client.query(
      "UPDATE liquidacoes_pagamento SET status = 'LIQUIDADA', data_liquidacao = NOW(), updated_at = NOW() WHERE id = $1 AND empresa_id = $2 RETURNING *",
      [liquidacao.id, usuario.empresa_id]
    );
    await client.query('COMMIT');
    return { conta: atualizadas[0], transacao_pagamento: transacao, liquidacao: liquidada[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pagar };
