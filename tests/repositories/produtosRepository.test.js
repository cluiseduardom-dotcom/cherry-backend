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
// iv.custo_unitario e iv.preco_unitario congelados, não produtos.custo/
// preco_venda atuais (ver migration 015; preco_unitario já existia).
describe('getLucroPorProduto', () => {
  test('uses iv.custo_unitario (frozen) instead of p.custo (current) to compute custo_total/lucro/margem_percentual', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    await produtosRepository.getLucroPorProduto(1);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('iv.quantidade * iv.custo_unitario');
    expect(sql).not.toContain('p.custo');
    expect(params).toEqual([1]);
  });

  test('uses iv.preco_unitario (frozen) instead of p.preco_venda (current) to compute faturamento/lucro/margem_percentual', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    await produtosRepository.getLucroPorProduto(1);

    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('iv.quantidade * iv.preco_unitario');
    expect(sql).toContain('iv.preco_unitario - iv.custo_unitario');
    expect(sql).not.toContain('p.preco_venda');
  });

  test('alterar produtos.preco_venda depois da venda não muda o lucro já calculado (faturamento/lucro vêm só de itens_venda)', async () => {
    // Prova estrutural, mesmo padrão do teste de custo_unitario em
    // vendasRepository.buscarPorId: a query nem lê p.preco_venda, então uma
    // mudança nesse campo depois da venda não pode afetar o resultado —
    // faturamento/lucro/margem_percentual são função só de iv.quantidade,
    // iv.preco_unitario e iv.custo_unitario, todos já gravados na venda.
    db.query = jest.fn().mockResolvedValue({
      rows: [{
        id: 1, nome: 'Anel', total_vendido: 3, faturamento: 30, custo_total: 12, lucro: 18, margem_percentual: 60
      }]
    });

    const [linha] = await produtosRepository.getLucroPorProduto(1);

    expect(linha.faturamento).toBe(30);
    expect(linha.lucro).toBe(18);
    const [sql] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/p\.preco_venda/);
  });
});
