jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const contasReceberRepository = require('../../src/repositories/contasReceberRepository');

function makeFakeClient({ contaPorVenda = {}, contaPorId = {} } = {}) {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return Promise.resolve({});
    }

    if (sql.includes('INSERT INTO contas_receber')) {
      return Promise.resolve({
        rows: [{ id: 1, venda_id: params[0], descricao: params[1], valor: params[2], data_vencimento: params[3], empresa_id: params[4], status: 'pendente' }]
      });
    }

    if (sql.includes('SELECT * FROM contas_receber WHERE venda_id = $1 AND empresa_id = $2 FOR UPDATE')) {
      return Promise.resolve({
        rows: contaPorVenda.existe === false ? [] : [{ id: contaPorVenda.id ?? 1, status: contaPorVenda.status ?? 'pendente' }]
      });
    }

    if (sql.includes('SELECT * FROM contas_receber WHERE id = $1 AND empresa_id = $2 FOR UPDATE')) {
      return Promise.resolve({
        rows: contaPorId.existe === false ? [] : [{ id: params[0], status: contaPorId.status ?? 'pendente' }]
      });
    }

    if (sql.includes("SET status = 'cancelado'")) {
      return Promise.resolve({ rows: [{ id: params[0], status: 'cancelado' }] });
    }

    if (sql.includes("SET status = 'recebido'")) {
      return Promise.resolve({ rows: [{ id: params[0], status: 'recebido', data_recebimento: '2026-07-27' }] });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('criar', () => {
  test('opens and commits its own transaction when no clienteExterno is given', async () => {
    const fakeClient = makeFakeClient();
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasReceberRepository.criar({
      venda_id: 1, descricao: 'Venda #1', valor: 100, data_vencimento: '2026-08-30', empresa_id: 9
    });

    expect(resultado.status).toBe('pendente');
    expect(fakeClient.query).toHaveBeenCalledWith('BEGIN');
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('reuses an external client without managing the transaction', async () => {
    const fakeClient = makeFakeClient();

    const resultado = await contasReceberRepository.criar({
      venda_id: 1, descricao: 'Venda #1', valor: 100, data_vencimento: '2026-08-30', empresa_id: 9
    }, fakeClient);

    expect(resultado.status).toBe('pendente');
    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).not.toContain('BEGIN');
    expect(sqlChamados).not.toContain('COMMIT');
    expect(fakeClient.release).not.toHaveBeenCalled();
  });
});

describe('cancelarPorVendaId', () => {
  test('cancels a pendente conta linked to the venda', async () => {
    const fakeClient = makeFakeClient({ contaPorVenda: { id: 5, status: 'pendente' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasReceberRepository.cancelarPorVendaId(1, 9);

    expect(resultado.status).toBe('cancelado');
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('throws 409 and rolls back when the conta is already recebida', async () => {
    const fakeClient = makeFakeClient({ contaPorVenda: { id: 5, status: 'recebido' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasReceberRepository.cancelarPorVendaId(1, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Venda com conta a receber já recebida não pode ser cancelada'
    });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados.some((sql) => sql.includes("SET status = 'cancelado'"))).toBe(false);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
  });

  test('is a no-op when the venda has no linked conta (à vista sale)', async () => {
    const fakeClient = makeFakeClient({ contaPorVenda: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasReceberRepository.cancelarPorVendaId(1, 9);

    expect(resultado).toBeNull();
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('reuses an external client without managing the transaction', async () => {
    const fakeClient = makeFakeClient({ contaPorVenda: { id: 5, status: 'pendente' } });

    await contasReceberRepository.cancelarPorVendaId(1, 9, fakeClient);

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).not.toContain('BEGIN');
    expect(sqlChamados).not.toContain('COMMIT');
    expect(fakeClient.release).not.toHaveBeenCalled();
  });

  test('propagates the 409 without touching the transaction when reusing an external client', async () => {
    const fakeClient = makeFakeClient({ contaPorVenda: { id: 5, status: 'recebido' } });

    await expect(contasReceberRepository.cancelarPorVendaId(1, 9, fakeClient)).rejects.toMatchObject({ statusCode: 409 });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).not.toContain('BEGIN');
    expect(sqlChamados).not.toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
    expect(fakeClient.release).not.toHaveBeenCalled();
  });
});

describe('marcarComoRecebida', () => {
  test('marks a pendente conta as recebida and commits', async () => {
    const fakeClient = makeFakeClient({ contaPorId: { status: 'pendente' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasReceberRepository.marcarComoRecebida(1, 9);

    expect(resultado.status).toBe('recebido');
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('throws 404 and rolls back when the conta does not exist', async () => {
    const fakeClient = makeFakeClient({ contaPorId: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasReceberRepository.marcarComoRecebida(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Conta a receber não encontrada'
    });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
  });

  test('throws 409 when the conta is already recebida', async () => {
    const fakeClient = makeFakeClient({ contaPorId: { status: 'recebido' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasReceberRepository.marcarComoRecebida(1, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Somente contas pendentes podem ser marcadas como recebidas'
    });
  });

  test('throws 409 when the conta is already cancelada', async () => {
    const fakeClient = makeFakeClient({ contaPorId: { status: 'cancelado' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasReceberRepository.marcarComoRecebida(1, 9)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('listarPaginado', () => {
  test('filters by empresa_id even when no other filter is provided', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const resultado = await contasReceberRepository.listarPaginado({ limit: 20, offset: 0, empresa_id: 9 });

    expect(resultado).toEqual({ items: [{ id: 1 }], total: 1 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE empresa_id = $1');
    expect(params).toEqual([9, 20, 0]);
  });

  test('applies a status filter alongside empresa_id', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await contasReceberRepository.listarPaginado({ limit: 20, offset: 0, status: 'pendente', empresa_id: 9 });

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

    await contasReceberRepository.listarPaginado({ limit: 20, offset: 0, vencimentoDe: de, vencimentoAte: ate, empresa_id: 9 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('data_vencimento >= $2');
    expect(sql).toContain('data_vencimento <= $3');
    expect(params).toEqual([9, de, ate, 20, 0]);
  });
});

describe('buscarPorId', () => {
  test('filters by id and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1 }] });

    const resultado = await contasReceberRepository.buscarPorId(1, 9);

    expect(resultado).toEqual({ id: 1 });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM contas_receber WHERE id = $1 AND empresa_id = $2',
      [1, 9]
    );
  });

  test('returns null when not found', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const resultado = await contasReceberRepository.buscarPorId(999, 9);

    expect(resultado).toBeNull();
  });
});
