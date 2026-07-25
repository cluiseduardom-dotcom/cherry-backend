jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');

function makeFakeClient({ estoqueAtual = 10 } = {}) {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };

  client.query.mockImplementation((sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return Promise.resolve({});
    }
    if (sql.includes('SELECT id, estoque_atual FROM produtos')) {
      return Promise.resolve({ rows: [{ id: 1, estoque_atual: estoqueAtual }] });
    }
    if (sql.includes('UPDATE produtos SET estoque_atual')) {
      return Promise.resolve({});
    }
    if (sql.includes('INSERT INTO movimentacoes_estoque')) {
      return Promise.resolve({ rows: [{ id: 1, produto_id: 1, tipo: 'saida', quantidade: 3, estoque_resultante: estoqueAtual - 3 }] });
    }
    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('without an external client (self-managed transaction, existing behavior)', () => {
  test('opens its own connection, runs BEGIN/COMMIT, and releases it', async () => {
    const fakeClient = makeFakeClient();
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await estoqueRepository.criarMovimentacao({
      produto_id: 1, tipo: 'saida', quantidade: 3, motivo: 'teste', usuario_id: 1
    });

    expect(db.connect).toHaveBeenCalledTimes(1);
    expect(fakeClient.query).toHaveBeenCalledWith('BEGIN');
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
    expect(resultado.movimentacao.id).toBe(1);
  });

  test('rolls back and releases on insufficient stock', async () => {
    const fakeClient = makeFakeClient({ estoqueAtual: 1 });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await estoqueRepository.criarMovimentacao({
      produto_id: 1, tipo: 'saida', quantidade: 5, motivo: 'teste', usuario_id: 1
    });

    expect(resultado).toEqual({ erro: 'ESTOQUE_INSUFICIENTE' });
    expect(fakeClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });
});

describe('with an external client (participates in the caller\'s transaction)', () => {
  test('does not open its own connection or manage BEGIN/COMMIT/release', async () => {
    const fakeClient = makeFakeClient();
    db.connect = jest.fn();

    const resultado = await estoqueRepository.criarMovimentacao(
      { produto_id: 1, tipo: 'saida', quantidade: 3, motivo: 'venda', usuario_id: 1 },
      fakeClient
    );

    expect(db.connect).not.toHaveBeenCalled();
    expect(fakeClient.query).not.toHaveBeenCalledWith('BEGIN');
    expect(fakeClient.query).not.toHaveBeenCalledWith('COMMIT');
    expect(fakeClient.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(fakeClient.release).not.toHaveBeenCalled();
    expect(resultado.movimentacao.id).toBe(1);
  });

  test('reports insufficient stock without rolling back itself (caller decides)', async () => {
    const fakeClient = makeFakeClient({ estoqueAtual: 1 });
    db.connect = jest.fn();

    const resultado = await estoqueRepository.criarMovimentacao(
      { produto_id: 1, tipo: 'saida', quantidade: 5, motivo: 'venda', usuario_id: 1 },
      fakeClient
    );

    expect(resultado).toEqual({ erro: 'ESTOQUE_INSUFICIENTE' });
    expect(fakeClient.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(fakeClient.release).not.toHaveBeenCalled();
  });
});
