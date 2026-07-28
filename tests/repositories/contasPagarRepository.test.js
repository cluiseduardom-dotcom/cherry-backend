jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const contasPagarRepository = require('../../src/repositories/contasPagarRepository');

function makeFakeClient({ conta = {} } = {}) {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return Promise.resolve({});
    }

    if (sql.includes('SELECT * FROM contas_pagar WHERE id = $1 FOR UPDATE')) {
      return Promise.resolve({
        rows: conta.existe === false ? [] : [{ id: params[0], status: conta.status ?? 'pendente' }]
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

    const resultado = await contasPagarRepository.marcarComoPaga(1);

    expect(resultado.status).toBe('pago');
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('throws 404 and rolls back when the conta does not exist', async () => {
    const fakeClient = makeFakeClient({ conta: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.marcarComoPaga(999)).rejects.toMatchObject({
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

    await expect(contasPagarRepository.marcarComoPaga(1)).rejects.toMatchObject({
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

    await expect(contasPagarRepository.marcarComoPaga(1)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('cancelar', () => {
  test('cancels a pendente conta and commits', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'pendente' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasPagarRepository.cancelar(1);

    expect(resultado.status).toBe('cancelado');
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('throws 404 when the conta does not exist', async () => {
    const fakeClient = makeFakeClient({ conta: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.cancelar(999)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 409 when the conta is already paga', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'pago' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.cancelar(1)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Somente contas pendentes podem ser canceladas'
    });
  });
});

describe('atualizar', () => {
  test('updates a pendente conta and commits', async () => {
    const fakeClient = makeFakeClient({ conta: { status: 'pendente' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasPagarRepository.atualizar(1, { valor: 200 });

    expect(resultado.valor).toBe(200);
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('throws 404 and rolls back when the conta does not exist', async () => {
    const fakeClient = makeFakeClient({ conta: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.atualizar(999, { valor: 200 })).rejects.toMatchObject({
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

    await expect(contasPagarRepository.atualizar(1, { valor: 200 })).rejects.toMatchObject({
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

    await expect(contasPagarRepository.atualizar(1, { valor: 200 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Contas pagas ou canceladas não podem ser editadas'
    });
  });
});

describe('listarPaginado', () => {
  test('lists without filters when none are provided', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const resultado = await contasPagarRepository.listarPaginado({ limit: 20, offset: 0 });

    expect(resultado).toEqual({ items: [{ id: 1 }], total: 1 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([20, 0]);
  });

  test('applies a status filter', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await contasPagarRepository.listarPaginado({ limit: 20, offset: 0, status: 'pendente' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('status = $1');
    expect(params).toEqual(['pendente', 20, 0]);
  });

  test('applies vencimentoDe and vencimentoAte together', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const de = '2026-01-01';
    const ate = '2026-12-31';

    await contasPagarRepository.listarPaginado({ limit: 20, offset: 0, vencimentoDe: de, vencimentoAte: ate });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('data_vencimento >= $1');
    expect(sql).toContain('data_vencimento <= $2');
    expect(params).toEqual([de, ate, 20, 0]);
  });
});
