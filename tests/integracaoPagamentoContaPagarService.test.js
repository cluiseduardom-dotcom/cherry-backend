jest.mock('../../src/config/db');
jest.mock('../../src/repositories/transacoesPagamentoRepository');
jest.mock('../../src/repositories/liquidacoesPagamentoRepository');

const db = require('../../src/config/db');
const transacoes = require('../../src/repositories/transacoesPagamentoRepository');
const liquidacoes = require('../../src/repositories/liquidacoesPagamentoRepository');
const service = require('../../src/services/integracaoPagamentoContaPagarService');

function clientFake(conta = { id: 10, status: 'pendente', valor: '100.00', data_vencimento: '2026-09-30' }) {
  return {
    query: jest.fn()
      .mockImplementation((sql) => {
        if (sql.includes('SELECT * FROM contas_pagar')) return Promise.resolve({ rows: [conta] });
        if (sql.includes("UPDATE contas_pagar SET status = 'pago'")) return Promise.resolve({ rows: [{ ...conta, status: 'pago', transacao_pagamento_id: 20 }] });
        if (sql.includes("UPDATE liquidacoes_pagamento SET status = 'LIQUIDADA'")) return Promise.resolve({ rows: [{ id: 30, status: 'LIQUIDADA' }] });
        return Promise.resolve({ rows: [] });
      }),
    release: jest.fn()
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  transacoes.criar.mockResolvedValue({ id: 20, tipo: 'PAGAMENTO', valor: '100.00', status: 'CONFIRMADA' });
  liquidacoes.criar.mockResolvedValue({ id: 30, status: 'PENDENTE' });
});

describe('integracaoPagamentoContaPagarService', () => {
  test('cria transação, liquidação e baixa a conta na mesma transação', async () => {
    const client = clientFake();
    db.connect.mockResolvedValue(client);

    const resultado = await service.pagar(10, { forma_pagamento: 'PIX' }, { id: 7, empresa_id: 9 });

    expect(transacoes.criar).toHaveBeenCalledWith(expect.objectContaining({
      empresa_id: 9,
      tipo: 'PAGAMENTO',
      forma_pagamento: 'PIX',
      valor: 100,
      status: 'CONFIRMADA'
    }), client);
    expect(liquidacoes.criar).toHaveBeenCalledWith(expect.objectContaining({
      empresa_id: 9,
      transacao_pagamento_id: 20,
      tipo: 'PAGAMENTO',
      valor_bruto: 100,
      valor_liquido: 100
    }), client);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(resultado.conta.status).toBe('pago');
    expect(resultado.transacao_pagamento.id).toBe(20);
    expect(resultado.liquidacao.id).toBe(30);
  });

  test('rejeita conta já paga e não cria pagamento', async () => {
    const client = clientFake({ id: 10, status: 'pago', valor: '100.00', data_vencimento: '2026-09-30' });
    db.connect.mockResolvedValue(client);

    await expect(service.pagar(10, {}, { id: 7, empresa_id: 9 })).rejects.toMatchObject({
      statusCode: 409
    });
    expect(transacoes.criar).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('faz rollback se a criação da liquidação falhar', async () => {
    const client = clientFake();
    db.connect.mockResolvedValue(client);
    liquidacoes.criar.mockRejectedValue(new Error('falha'));

    await expect(service.pagar(10, {}, { id: 7, empresa_id: 9 })).rejects.toThrow('falha');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });
});
