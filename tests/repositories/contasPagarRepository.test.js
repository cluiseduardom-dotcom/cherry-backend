jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const contasPagarRepository = require('../../src/repositories/contasPagarRepository');

function makeFakeClient({ conta = {}, contaPorCompra = {} } = {}) {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return Promise.resolve({});
    }

    if (sql.includes('INSERT INTO contas_pagar')) {
      return Promise.resolve({
        rows: [{ id: 1, descricao: params[0], fornecedor: params[1], valor: params[2], data_vencimento: params[3], empresa_id: params[7], compra_id: params[8], status: 'pendente' }]
      });
    }

    if (sql.includes('SELECT * FROM contas_pagar WHERE id = $1 AND empresa_id = $2 FOR UPDATE')) {
      return Promise.resolve({
        rows: conta.existe === false ? [] : [{ id: params[0], status: conta.status ?? 'pendente' }]
      });
    }

    if (sql.includes('SELECT * FROM contas_pagar WHERE compra_id = $1 AND empresa_id = $2 FOR UPDATE')) {
      return Promise.resolve({
        rows: contaPorCompra.existe === false ? [] : [{ id: contaPorCompra.id ?? 1, status: contaPorCompra.status ?? 'pendente' }]
      });
    }

    if (sql.includes("SET status = 'pago'")) {
      return Promise.resolve({ rows: [{ id: params[0], status: 'pago', data_pagamento: '2026-07-27' }] });
    }

    if (sql.includes("SET status = 'cancelado'")) {
      return Promise.resolve({ rows: [{ id: params[0], status: 'cancelado' }] });
    }

    if (sql.startsWith('UPDATE contas_pagar SET')) {
      return Promise.resolve({ rows: [{ id: params[params.length - 1], status: 'pendente', valor: params[0] }] });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('marcarComoPaga', () => {
  test('marks a pendente conta as paga and commits', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'pendente' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasPagarRepository.marcarComoPaga(1, 9);

    expect(resultado.status).toBe('pago');
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('throws 404 and rolls back when the conta does not exist', async () => {
    const fakeClient = makeFakeClient({ conta: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.marcarComoPaga(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Conta a pagar não encontrada'
    });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
  });

  test('throws 409 and rolls back when the conta is already paga', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'pago' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.marcarComoPaga(1, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Somente contas pendentes podem ser marcadas como pagas'
    });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados.some((sql) => sql.includes("SET status = 'pago'"))).toBe(false);
  });

  test('throws 409 when the conta is already cancelada', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'cancelado' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.marcarComoPaga(1, 9)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('cancelar', () => {
  test('cancels a pendente conta and commits', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'pendente' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasPagarRepository.cancelar(1, 9);

    expect(resultado.status).toBe('cancelado');
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('throws 404 when the conta does not exist', async () => {
    const fakeClient = makeFakeClient({ conta: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.cancelar(999, 9)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 409 when the conta is already paga', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'pago' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.cancelar(1, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Somente contas pendentes podem ser canceladas'
    });
  });
});

describe('atualizar', () => {
  test('updates a pendente conta and commits', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'pendente' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasPagarRepository.atualizar(1, { valor: 200 }, 9);

    expect(resultado.valor).toBe(200);
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('throws 404 and rolls back when the conta does not exist', async () => {
    const fakeClient = makeFakeClient({ conta: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.atualizar(999, { valor: 200 }, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Conta a pagar não encontrada'
    });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
  });

  test('throws 409 and rolls back when the conta is already paga', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'pago' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.atualizar(1, { valor: 200 }, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Contas pagas ou canceladas não podem ser editadas'
    });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados.some((sql) => sql.startsWith('UPDATE contas_pagar SET'))).toBe(false);
  });

  test('throws 409 and rolls back when the conta is already cancelada', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'cancelado' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.atualizar(1, { valor: 200 }, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Contas pagas ou canceladas não podem ser editadas'
    });
  });
});

describe('listarPaginado', () => {
  test('filters by empresa_id even when no other filter is provided', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const resultado = await contasPagarRepository.listarPaginado({ limit: 20, offset: 0, empresa_id: 9 });

    expect(resultado).toEqual({ items: [{ id: 1 }], total: 1 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE empresa_id = $1');
    expect(params).toEqual([9, 20, 0]);
  });

  test('applies a status filter alongside empresa_id', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await contasPagarRepository.listarPaginado({ limit: 20, offset: 0, status: 'pendente', empresa_id: 9 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('status = $2');
    expect(params).toEqual([9, 'pendente', 20, 0]);
  });

  test('applies vencimentoDe and vencimentoAte together with empresa_id', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const de = '2026-01-01';
    const ate = '2026-12-31';

    await contasPagarRepository.listarPaginado({ limit: 20, offset: 0, vencimentoDe: de, vencimentoAte: ate, empresa_id: 9 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('data_vencimento >= $2');
    expect(sql).toContain('data_vencimento <= $3');
    expect(params).toEqual([9, de, ate, 20, 0]);
  });
});

describe('criar', () => {
  test('runs as a standalone statement (no BEGIN/COMMIT) when no clienteExterno is given', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, descricao: 'Compra #1', fornecedor: 'Metais & Cia', valor: 100, compra_id: 3, status: 'pendente' }]
    });

    const resultado = await contasPagarRepository.criar({
      descricao: 'Compra #1', fornecedor: 'Metais & Cia', valor: 100, data_vencimento: '2026-09-10',
      usuario_id: 2, empresa_id: 9, compra_id: 3
    });

    expect(resultado.compra_id).toBe(3);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO contas_pagar');
    expect(params).toEqual(['Compra #1', 'Metais & Cia', 100, '2026-09-10', null, null, 2, 9, 3]);
  });

  test('reuses an external client without managing the transaction', async () => {
    const fakeClient = makeFakeClient();

    const resultado = await contasPagarRepository.criar({
      descricao: 'Compra #1', fornecedor: 'Metais & Cia', valor: 100, data_vencimento: '2026-09-10',
      usuario_id: 2, empresa_id: 9, compra_id: 3
    }, fakeClient);

    expect(resultado.compra_id).toBe(3);
    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).not.toContain('BEGIN');
    expect(sqlChamados).not.toContain('COMMIT');
    expect(fakeClient.release).not.toHaveBeenCalled();
  });

  test('defaults compra_id to null for a manual lançamento (no compra behind it)', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, compra_id: null, status: 'pendente' }] });

    await contasPagarRepository.criar({
      descricao: 'Aluguel', valor: 100, data_vencimento: '2026-09-10', usuario_id: 2, empresa_id: 9
    });

    const [, params] = db.query.mock.calls[0];
    expect(params[params.length - 1]).toBeNull();
  });
});

describe('cancelarPorCompraId', () => {
  test('cancels a pendente conta linked to the compra', async () => {
    const fakeClient = makeFakeClient({ contaPorCompra: { id: 5, status: 'pendente' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasPagarRepository.cancelarPorCompraId(1, 9);

    expect(resultado.status).toBe('cancelado');
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('throws 409 and rolls back when the conta is already paga', async () => {
    const fakeClient = makeFakeClient({ contaPorCompra: { id: 5, status: 'pago' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.cancelarPorCompraId(1, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Compra com conta a pagar já paga não pode ser cancelada'
    });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados.some((sql) => sql.includes("SET status = 'cancelado'"))).toBe(false);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
  });

  test('is a no-op when the compra has no linked conta (à vista compra)', async () => {
    const fakeClient = makeFakeClient({ contaPorCompra: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasPagarRepository.cancelarPorCompraId(1, 9);

    expect(resultado).toBeNull();
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('reuses an external client without managing the transaction', async () => {
    const fakeClient = makeFakeClient({ contaPorCompra: { id: 5, status: 'pendente' } });

    await contasPagarRepository.cancelarPorCompraId(1, 9, fakeClient);

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).not.toContain('BEGIN');
    expect(sqlChamados).not.toContain('COMMIT');
    expect(fakeClient.release).not.toHaveBeenCalled();
  });

  test('propagates the 409 without touching the transaction when reusing an external client', async () => {
    const fakeClient = makeFakeClient({ contaPorCompra: { id: 5, status: 'pago' } });

    await expect(contasPagarRepository.cancelarPorCompraId(1, 9, fakeClient)).rejects.toMatchObject({ statusCode: 409 });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).not.toContain('BEGIN');
    expect(sqlChamados).not.toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
    expect(fakeClient.release).not.toHaveBeenCalled();
  });
});
