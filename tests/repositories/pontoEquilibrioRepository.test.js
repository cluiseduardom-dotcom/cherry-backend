jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const pontoEquilibrioRepository = require('../../src/repositories/pontoEquilibrioRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('somarReceita', () => {
  test('sums only vendas finalizada, scoped to empresa_id and periodo', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ total: '23017.33' }] });

    const resultado = await pontoEquilibrioRepository.somarReceita(9, '2026-08-01', '2026-08-19');

    expect(resultado).toBe('23017.33');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("status = 'finalizada'");
    expect(sql).toContain('empresa_id = $1');
    expect(params).toEqual([9, '2026-08-01', '2026-08-19']);
  });
});

describe('somarCustoVariavelProdutos', () => {
  test('sums quantidade * custo for itens de vendas finalizada in the periodo', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ total: '11623.63' }] });

    const resultado = await pontoEquilibrioRepository.somarCustoVariavelProdutos(9, '2026-08-01', '2026-08-19');

    expect(resultado).toBe('11623.63');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('iv.quantidade * p.custo');
    expect(sql).toContain("v.status = 'finalizada'");
    expect(sql).toContain('v.empresa_id = $1');
    expect(params).toEqual([9, '2026-08-01', '2026-08-19']);
  });
});
