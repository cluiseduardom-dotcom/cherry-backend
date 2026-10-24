jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');

function makeFakeClient({ estoqueAtual = 10, custo = '15.50', saldoLocal = estoqueAtual, localExiste = true } = {}) {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };

  client.query.mockImplementation((sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return Promise.resolve({});
    }
    if (sql.includes('SELECT id, estoque_atual, custo FROM produtos')) {
      return Promise.resolve({ rows: [{ id: 1, estoque_atual: estoqueAtual, custo }] });
    }
    if (sql.includes('INSERT INTO locais_estoque')) {
      return Promise.resolve({});
    }
    if (sql.includes("tipo = 'central'")) {
      return Promise.resolve({ rows: [{ id: 7 }] });
    }
    if (sql.includes('FROM locais_estoque WHERE id = $1')) {
      return Promise.resolve({ rows: localExiste ? [{ id: 9 }] : [] });
    }
    if (sql.includes('INSERT INTO estoque_locais')) {
      return Promise.resolve({});
    }
    if (sql.includes('FROM estoque_locais WHERE produto_id')) {
      return Promise.resolve({ rows: [{ saldo: saldoLocal }] });
    }
    if (sql.includes('UPDATE estoque_locais')) {
      return Promise.resolve({});
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

  test('returns the produto custo read from the same locked SELECT, for callers that need to freeze it', async () => {
    const fakeClient = makeFakeClient({ custo: '22.90' });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await estoqueRepository.criarMovimentacao({
      produto_id: 1, tipo: 'saida', quantidade: 3, motivo: 'teste', usuario_id: 1
    });

    expect(resultado.custo).toBe('22.90');
    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados.filter((sql) => sql.includes('FROM produtos'))).toHaveLength(1);
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

describe('estoque por local', () => {
  const chamada = (client, trecho) => client.query.mock.calls.find(([sql]) => sql.includes(trecho));

  test('sem local_id usa o Central da empresa e grava o local na movimentação', async () => {
    const fakeClient = makeFakeClient({ estoqueAtual: 10 });
    db.connect = jest.fn();

    await estoqueRepository.criarMovimentacao(
      { produto_id: 1, tipo: 'saida', quantidade: 3, usuario_id: 1, empresa_id: 4 },
      fakeClient
    );

    const insert = chamada(fakeClient, 'INSERT INTO movimentacoes_estoque');
    expect(insert[1][7]).toBe(7); // local_id
    expect(insert[1][8]).toBe(7); // saldo_local_resultante (10 - 3)
  });

  test('saída de um local usa o saldo DO LOCAL, não o total', async () => {
    const fakeClient = makeFakeClient({ estoqueAtual: 10, saldoLocal: 2 });
    db.connect = jest.fn();

    const resultado = await estoqueRepository.criarMovimentacao(
      { produto_id: 1, tipo: 'saida', quantidade: 5, usuario_id: 1, empresa_id: 4, local_id: 9 },
      fakeClient
    );

    expect(resultado).toEqual({ erro: 'ESTOQUE_INSUFICIENTE' });
    expect(chamada(fakeClient, 'UPDATE estoque_locais')).toBeUndefined();
  });

  test('ajuste define o saldo do local e move o total pela diferença', async () => {
    const fakeClient = makeFakeClient({ estoqueAtual: 10, saldoLocal: 4 });
    db.connect = jest.fn();

    await estoqueRepository.criarMovimentacao(
      { produto_id: 1, tipo: 'ajuste', quantidade: 7, usuario_id: 1, empresa_id: 4, local_id: 9 },
      fakeClient
    );

    expect(chamada(fakeClient, 'UPDATE estoque_locais')[1][0]).toBe(7);
    expect(chamada(fakeClient, 'UPDATE produtos SET estoque_atual')[1][0]).toBe(13); // 10 + (7 - 4)
  });

  test('local inexistente, de outra empresa ou inativo devolve LOCAL_NAO_ENCONTRADO', async () => {
    const fakeClient = makeFakeClient({ localExiste: false });
    db.connect = jest.fn();

    const resultado = await estoqueRepository.criarMovimentacao(
      { produto_id: 1, tipo: 'entrada', quantidade: 1, usuario_id: 1, empresa_id: 4, local_id: 99 },
      fakeClient
    );

    expect(resultado).toEqual({ erro: 'LOCAL_NAO_ENCONTRADO' });
    expect(chamada(fakeClient, 'UPDATE produtos SET estoque_atual')).toBeUndefined();
  });
});
