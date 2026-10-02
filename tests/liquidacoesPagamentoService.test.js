const service = require('../src/services/liquidacoesPagamentoService');

jest.mock('../src/repositories/liquidacoesPagamentoRepository', () => ({
  criar: jest.fn(async d => ({ id: 1, ...d })),
  buscarPorId: jest.fn(async (id, empresaId) => (
    id === 1 && empresaId === 10
      ? { id: 1, empresa_id: 10, status: 'PREVISTA' }
      : null
  )),
  listar: jest.fn(async () => []),
  atualizarStatus: jest.fn(async (id, empresaId, status, data) => ({
    id,
    empresa_id: empresaId,
    status,
    data_liquidacao: data
  }))
}));

jest.mock('../src/repositories/transacoesPagamentoRepository', () => ({
  buscarPorId: jest.fn(async (id, empresaId) => (
    id === 7 && empresaId === 10
      ? { id: 7, empresa_id: 10 }
      : null
  ))
}));

describe('liquidacoesPagamentoService', () => {
  test('cria liquidação com líquido calculado', async () => {
    const result = await service.criar({
      empresa_id: 10,
      transacao_pagamento_id: 7,
      tipo: 'RECEBIMENTO',
      valor_bruto: 1000,
      taxa: 30
    });
    expect(result.valor_liquido).toBe(970);
  });

  test('impede transação de outra empresa', async () => {
    await expect(service.criar({
      empresa_id: 20,
      transacao_pagamento_id: 7,
      tipo: 'RECEBIMENTO',
      valor_bruto: 100
    })).rejects.toThrow('transação de pagamento não encontrada');
  });

  test('liquida uma previsão válida', async () => {
    const result = await service.liquidar(
      1,
      10,
      new Date('2026-10-30T12:00:00Z')
    );
    expect(result.status).toBe('LIQUIDADA');
  });
});
