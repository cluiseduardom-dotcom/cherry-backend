jest.mock('../../src/config/db');
jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/repositories/shared/transacoes');

const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');
const { executarComLock } = require('../../src/repositories/shared/transacoes');
const producoesRepository = require('../../src/repositories/producoesRepository');
const AppError = require('../../src/errors/AppError');

function makeFakeClient({
  produto = { existe: true, tipo: 'acabado', ativo: true },
  ficha = { existe: true, id: 20 },
  itensFicha = [],
  estoqueInsumos = {},
  producaoInsert = { id: 100 }
} = {}) {
  const client = { query: jest.fn(), release: jest.fn() };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({});

    if (sql.includes('SELECT id, tipo, ativo FROM produtos WHERE id = $1 AND empresa_id = $2')) {
      return Promise.resolve({ rows: produto.existe === false ? [] : [{ id: params[0], tipo: produto.tipo, ativo: produto.ativo }] });
    }

    if (sql.includes("FROM fichas_tecnicas WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true")) {
      return Promise.resolve({ rows: ficha.existe === false ? [] : [{ id: ficha.id }] });
    }

    if (sql.includes('FROM itens_ficha_tecnica WHERE ficha_tecnica_id = $1')) {
      return Promise.resolve({ rows: itensFicha });
    }

    if (sql.includes('FOR UPDATE') && sql.includes('WHERE id = ANY(')) {
      const ids = params[0];
      return Promise.resolve({ rows: ids.map((id) => ({ id, estoque_atual: estoqueInsumos[id] ?? 0 })) });
    }

    if (sql.includes('INSERT INTO producoes')) {
      return Promise.resolve({ rows: [{ id: producaoInsert.id, empresa_id: params[0], produto_id: params[1], ficha_tecnica_id: params[2], quantidade_solicitada: params[3], quantidade_produzida: params[4], status: 'concluida' }] });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => jest.clearAllMocks());

describe('criar', () => {
  test('throws 400 when produto is not tipo acabado', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({ produto: { existe: true, tipo: 'insumo', ativo: true } }));

    await expect(producoesRepository.criar({ produto_id: 1, quantidade_solicitada: 5, usuario_id: 1, empresa_id: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws 400 when produto has no ficha técnica vigente', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({ ficha: { existe: false } }));

    await expect(producoesRepository.criar({ produto_id: 1, quantidade_solicitada: 5, usuario_id: 1, empresa_id: 1 }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('ficha técnica') });
  });

  test('produces the full quantidade_solicitada when stock is sufficient for every insumo', async () => {
    const fakeClient = makeFakeClient({
      itensFicha: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }, { insumo_produto_id: 3, quantidade_necessaria: 1 }],
      estoqueInsumos: { 2: 100, 3: 100 }
    });
    db.connect = jest.fn().mockResolvedValue(fakeClient);
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

    const producao = await producoesRepository.criar({ produto_id: 1, quantidade_solicitada: 10, usuario_id: 1, empresa_id: 1 });

    expect(producao.quantidade_produzida).toBe(10);
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      expect.objectContaining({ produto_id: 2, tipo: 'saida', quantidade: 20 }), fakeClient
    );
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      expect.objectContaining({ produto_id: 1, tipo: 'entrada', quantidade: 10 }), fakeClient
    );
  });

  test('produces a partial quantidade when one insumo is the bottleneck', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({
      itensFicha: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }],
      estoqueInsumos: { 2: 12 } // só dá pra fazer 6 (12/2), mesmo pedindo 10
    }));
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

    const producao = await producoesRepository.criar({ produto_id: 1, quantidade_solicitada: 10, usuario_id: 1, empresa_id: 1 });

    expect(producao.quantidade_produzida).toBe(6);
  });

  test('throws 409 and never inserts a producao row when no insumo has stock for even 1 unit', async () => {
    const fakeClient = makeFakeClient({
      itensFicha: [{ insumo_produto_id: 2, quantidade_necessaria: 5 }],
      estoqueInsumos: { 2: 3 } // floor(3/5) = 0
    });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(producoesRepository.criar({ produto_id: 1, quantidade_solicitada: 10, usuario_id: 1, empresa_id: 1 }))
      .rejects.toMatchObject({ statusCode: 409 });

    expect(fakeClient.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO producoes'), expect.anything());
    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });
});

describe('cancelar', () => {
  test('returns 404 when producao does not exist', async () => {
    executarComLock.mockImplementation(async (tabela, filtro, empresaId, clienteExterno, callback) => callback(null, {}));

    await expect(producoesRepository.cancelar(1, 1, 1)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('returns 409 when producao is already cancelada', async () => {
    executarComLock.mockImplementation(async (tabela, filtro, empresaId, clienteExterno, callback) =>
      callback({ id: 1, status: 'cancelada' }, {})
    );

    await expect(producoesRepository.cancelar(1, 1, 1)).rejects.toMatchObject({ statusCode: 409 });
  });

  test('returns 409 without touching insumos when acabado stock cannot absorb the estorno saída', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] }) };
    executarComLock.mockImplementation(async (tabela, filtro, empresaId, clienteExterno, callback) =>
      callback({ id: 1, status: 'concluida', produto_id: 1, quantidade_produzida: 5, ficha_tecnica_id: 20 }, client)
    );
    estoqueRepository.criarMovimentacao.mockResolvedValueOnce({ erro: 'ESTOQUE_INSUFICIENTE' });

    await expect(producoesRepository.cancelar(1, 1, 1)).rejects.toMatchObject({ statusCode: 409 });
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledTimes(1); // só tentou o acabado, nunca chegou nos insumos
  });

  test('estorna saída do acabado e entrada de cada insumo, então marca cancelada', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'cancelada' }] })
    };
    executarComLock.mockImplementation(async (tabela, filtro, empresaId, clienteExterno, callback) =>
      callback({ id: 1, status: 'concluida', produto_id: 1, quantidade_produzida: 5, ficha_tecnica_id: 20 }, client)
    );
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

    const result = await producoesRepository.cancelar(1, 7, 1);

    expect(result.status).toBe('cancelada');
    expect(estoqueRepository.criarMovimentacao).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ produto_id: 1, tipo: 'saida', quantidade: 5 }), client
    );
    expect(estoqueRepository.criarMovimentacao).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ produto_id: 2, tipo: 'entrada', quantidade: 10 }), client // 2 * 5
    );
  });
});
