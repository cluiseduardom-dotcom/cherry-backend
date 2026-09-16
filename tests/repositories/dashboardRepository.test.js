jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const dashboardRepository = require('../../src/repositories/dashboardRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getVendasEstoquePorProduto', () => {
  test('devolve valores crus (sem giro/cobertura calculados em SQL), escopado por empresa, produto ativo e período', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, nome: 'Colar', sku: 'BR001', estoque_atual: 10, quantidade_vendida_periodo: '5' }]
    });

    const resultado = await dashboardRepository.getVendasEstoquePorProduto(90, 9);

    expect(resultado).toEqual([{ id: 1, nome: 'Colar', sku: 'BR001', estoque_atual: 10, quantidade_vendida_periodo: '5' }]);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("v.status = 'finalizada'");
    expect(sql).toContain('p.ativo = true');
    expect(sql).toContain('p.empresa_id = $2');
    expect(sql).toContain('p.sku');
    expect(sql).not.toMatch(/giro|cobertura/i);
    expect(params).toEqual([90, 9]);
  });
});

describe('getVinculosCategoriasProdutos', () => {
  test('junta produtos_categorias com categorias_produto escopado por empresa, sem filtrar categoria soft-deletada', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ produto_id: 1, categoria_id: 10, nivel: 1, categoria_nome: 'Colares' }]
    });

    const resultado = await dashboardRepository.getVinculosCategoriasProdutos(9);

    expect(resultado).toEqual([{ produto_id: 1, categoria_id: 10, nivel: 1, categoria_nome: 'Colares' }]);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('produtos_categorias');
    expect(sql).toContain('categorias_produto');
    expect(sql).toContain('pc.empresa_id = $1');
    expect(sql).not.toContain('deletado_em');
    expect(params).toEqual([9]);
  });
});

describe('getNiveisExistentes', () => {
  test('devolve níveis distintos com categoria ativa, escopado por empresa', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ nivel: 1 }, { nivel: 2 }] });

    const resultado = await dashboardRepository.getNiveisExistentes(9);

    expect(resultado).toEqual([1, 2]);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('DISTINCT nivel');
    expect(sql).toContain('categorias_produto');
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([9]);
  });
});
