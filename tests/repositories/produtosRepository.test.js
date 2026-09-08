jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const produtosRepository = require('../../src/repositories/produtosRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('criar', () => {
  test('defaults tipo to acabado when not provided', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{
        id: 1,
        sku: 'SKU-1',
        nome: 'Anel',
        preco_venda: 100,
        custo: 40,
        empresa_id: 1,
        tipo: 'acabado'
      }]
    });

    const produto = await produtosRepository.criar({
      sku: 'SKU-1',
      nome: 'Anel',
      preco_venda: 100,
      custo: 40,
      empresa_id: 1
    });

    expect(produto.tipo).toBe('acabado');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('tipo');
    expect(params[9]).toBe('acabado');
  });

  test('persists tipo when provided as insumo', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{
        id: 2,
        sku: 'SKU-2',
        nome: 'Prata 950g',
        preco_venda: 10,
        custo: 5,
        empresa_id: 1,
        tipo: 'insumo'
      }]
    });

    const produto = await produtosRepository.criar({
      sku: 'SKU-2',
      nome: 'Prata 950g',
      preco_venda: 10,
      custo: 5,
      tipo: 'insumo',
      empresa_id: 1
    });

    expect(produto.tipo).toBe('insumo');
    const [sql, params] = db.query.mock.calls[0];
    expect(params[9]).toBe('insumo');
  });
});

describe('atualizar', () => {
  test('includes tipo in the editable campos array', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{
        id: 1,
        sku: 'SKU-1',
        nome: 'Anel',
        preco_venda: 100,
        custo: 40,
        empresa_id: 1,
        tipo: 'insumo'
      }]
    });

    const produto = await produtosRepository.atualizar(1, { tipo: 'insumo' }, 1);

    expect(produto.tipo).toBe('insumo');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('tipo = $1');
    expect(params).toEqual(['insumo', 1, 1]);
  });
});

// getLucroPorProduto é margem HISTÓRICA (o que já foi vendido) — usa
// iv.custo_unitario congelado, não produtos.custo atual (ver migration 015).
describe('getLucroPorProduto', () => {
  test('uses iv.custo_unitario (frozen) instead of p.custo (current) to compute custo_total/lucro/margem_percentual', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    await produtosRepository.getLucroPorProduto(1);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('iv.quantidade * iv.custo_unitario');
    expect(sql).not.toContain('p.custo');
    expect(sql).toContain('p.preco_venda - iv.custo_unitario');
    expect(params).toEqual([1]);
  });
});
