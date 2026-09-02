jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const configuracoesFinanceirasRepository = require('../../src/repositories/configuracoesFinanceirasRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('obterOuCriar', () => {
  test('upserts a row scoped to empresa_id in a single query', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ empresa_id: 9, aliquota_imposto: '0.0000' }] });

    const resultado = await configuracoesFinanceirasRepository.obterOuCriar(9);

    expect(resultado).toEqual({ empresa_id: 9, aliquota_imposto: '0.0000' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO configuracoes_financeiras (empresa_id)');
    expect(sql).toContain('ON CONFLICT (empresa_id) DO UPDATE');
    expect(params).toEqual([9]);
  });
});

describe('atualizar', () => {
  test('upserts aliquota_imposto scoped to empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ empresa_id: 9, aliquota_imposto: '0.0600' }] });

    const resultado = await configuracoesFinanceirasRepository.atualizar(9, 0.06);

    expect(resultado.aliquota_imposto).toBe('0.0600');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (empresa_id) DO UPDATE SET aliquota_imposto = $2');
    expect(params).toEqual([9, 0.06]);
  });
});
