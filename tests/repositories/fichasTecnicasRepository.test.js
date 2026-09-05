jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const fichasTecnicasRepository = require('../../src/repositories/fichasTecnicasRepository');
const AppError = require('../../src/errors/AppError');

function makeFakeClient({ produto = { existe: true, tipo: 'acabado' }, insumos = {}, fichaAnterior = null } = {}) {
  const client = { query: jest.fn(), release: jest.fn() };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({});

    if (sql.includes('SELECT id, tipo FROM produtos WHERE id = $1 AND empresa_id = $2')) {
      return Promise.resolve({ rows: produto.existe === false ? [] : [{ id: params[0], tipo: produto.tipo }] });
    }

    if (sql.includes('SELECT id, tipo, custo FROM produtos WHERE id = $1 AND empresa_id = $2')) {
      const insumo = insumos[params[0]];
      return Promise.resolve({ rows: insumo ? [{ id: params[0], tipo: insumo.tipo, custo: insumo.custo }] : [] });
    }

    if (sql.includes('UPDATE fichas_tecnicas SET vigente = false')) {
      return Promise.resolve({});
    }

    if (sql.includes('INSERT INTO fichas_tecnicas')) {
      return Promise.resolve({ rows: [{ id: 10, empresa_id: params[0], produto_id: params[1], vigente: true, criado_por: params[2], criado_em: new Date() }] });
    }

    if (sql.includes('INSERT INTO itens_ficha_tecnica')) {
      const itens = [];
      for (let i = 0; i < params.length; i += 4) {
        itens.push({ id: itens.length + 1, insumo_produto_id: params[i + 1], quantidade_necessaria: params[i + 2] });
      }
      return Promise.resolve({ rows: itens });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => jest.clearAllMocks());

describe('criarVersao', () => {
  test('throws 404 when produto does not exist in this empresa', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({ produto: { existe: false } }));

    await expect(fichasTecnicasRepository.criarVersao({
      produto_id: 1, itens: [{ insumo_produto_id: 2, quantidade_necessaria: 3 }], usuario_id: 1, empresa_id: 1
    })).rejects.toMatchObject({ statusCode: 404, message: 'Produto não encontrado' });
  });

  test('throws 400 when produto exists but is not tipo acabado', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({ produto: { existe: true, tipo: 'insumo' } }));

    await expect(fichasTecnicasRepository.criarVersao({
      produto_id: 1, itens: [{ insumo_produto_id: 2, quantidade_necessaria: 3 }], usuario_id: 1, empresa_id: 1
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws 400 when an item is not tipo insumo', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({
      produto: { existe: true, tipo: 'acabado' },
      insumos: { 2: { tipo: 'acabado', custo: 5 } }
    }));

    await expect(fichasTecnicasRepository.criarVersao({
      produto_id: 1, itens: [{ insumo_produto_id: 2, quantidade_necessaria: 3 }], usuario_id: 1, empresa_id: 1
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('computes custo_sugerido as the sum of quantidade_necessaria * custo, and marks the previous version não vigente', async () => {
    const fakeClient = makeFakeClient({
      produto: { existe: true, tipo: 'acabado' },
      insumos: { 2: { tipo: 'insumo', custo: 10 }, 3: { tipo: 'insumo', custo: 4 } }
    });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const ficha = await fichasTecnicasRepository.criarVersao({
      produto_id: 1,
      itens: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }, { insumo_produto_id: 3, quantidade_necessaria: 5 }],
      usuario_id: 1,
      empresa_id: 1
    });

    expect(ficha.custo_sugerido).toBe(40); // 2*10 + 5*4
    expect(ficha.itens).toHaveLength(2);
    expect(fakeClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE fichas_tecnicas SET vigente = false'),
      [1, 1]
    );
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });
});

describe('buscarVigentePorProduto', () => {
  test('returns null when there is no vigente ficha', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    const result = await fichasTecnicasRepository.buscarVigentePorProduto(1, 1);
    expect(result).toBeNull();
  });

  test('returns the ficha with itens and custo_sugerido', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 10, produto_id: 1, vigente: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, insumo_produto_id: 2, quantidade_necessaria: 3, custo_unitario: '10.00', insumo_nome: 'Prata' }] });

    const result = await fichasTecnicasRepository.buscarVigentePorProduto(1, 1);

    expect(result.custo_sugerido).toBe(30);
    expect(result.itens[0].subtotal_custo).toBe(30);
  });
});
