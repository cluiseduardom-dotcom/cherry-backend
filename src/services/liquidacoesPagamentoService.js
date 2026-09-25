const repo = require('../repositories/liquidacoesPagamentoRepository');
const transacoesRepo = require('../repositories/transacoesPagamentoRepository');

const TIPOS = new Set(['PAGAMENTO', 'RECEBIMENTO']);
const STATUS = new Set(['PENDENTE', 'PREVISTA', 'LIQUIDADA', 'CANCELADA', 'ESTORNADA']);

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function criar(dados, contexto = {}) {
  const empresaId = contexto.empresa_id ?? dados.empresa_id;
  if (!Number.isInteger(Number(empresaId))) throw new Error('empresa_id inválido');

  if (!TIPOS.has(dados.tipo)) throw new Error('tipo inválido');

  const transacaoId = Number(dados.transacao_pagamento_id);
  if (!Number.isInteger(transacaoId) || transacaoId <= 0) {
    throw new Error('transacao_pagamento_id inválido');
  }

  const transacao = await transacoesRepo.buscarPorId(transacaoId, empresaId);
  if (!transacao) throw new Error('transação de pagamento não encontrada');

  const bruto = numero(dados.valor_bruto);
  const taxa = numero(dados.taxa ?? 0);
  const liquidoInformado = dados.valor_liquido == null ? null : numero(dados.valor_liquido);
  if (bruto === null || bruto <= 0) throw new Error('valor_bruto inválido');
  if (taxa === null || taxa < 0 || taxa > bruto) throw new Error('taxa inválida');

  const liquido = liquidoInformado ?? Number((bruto - taxa).toFixed(2));
  if (liquido < 0 || liquido > bruto) throw new Error('valor_liquido inválido');

  const status = dados.status ?? 'PENDENTE';
  if (!STATUS.has(status)) throw new Error('status inválido');

  return repo.criar({
    ...dados,
    empresa_id: empresaId,
    transacao_pagamento_id: transacaoId,
    transacao_pagamento_parcela_id: dados.transacao_pagamento_parcela_id ?? null,
    valor_bruto: bruto,
    taxa,
    valor_liquido: liquido,
    status,
    usuario_id: contexto.usuario_id ?? dados.usuario_id ?? null
  });
}

async function buscarPorId(id, empresaId) {
  return repo.buscarPorId(id, empresaId);
}

async function listar(empresaId, filtros) {
  return repo.listar(empresaId, filtros);
}

async function liquidar(id, empresaId, dataLiquidacao = new Date()) {
  const atual = await repo.buscarPorId(id, empresaId);
  if (!atual) throw new Error('liquidação não encontrada');
  if (['CANCELADA', 'ESTORNADA'].includes(atual.status)) {
    throw new Error('liquidação não pode ser liquidada');
  }
  return repo.atualizarStatus(id, empresaId, 'LIQUIDADA', dataLiquidacao);
}

module.exports = { criar, buscarPorId, listar, liquidar };
