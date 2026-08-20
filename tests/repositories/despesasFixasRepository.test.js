jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const despesasFixasRepository = require('../../src/repositories/despesasFixasRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('filters by empresa_id and deletado_em IS NULL', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1 }] });

    const resultado = await despesasFixasRepository.listar(9);

    expect(resultado).toEqual([{ id: 1 }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([9]);
  });
});

describe('criar', () => {
  test('inserts with the given empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, categoria: 'pessoal', descricao: 'Salários', valor: '5000.00' }] });

    const resultado = await despesasFixasRepository.criar({
      categoria: 'pessoal', descricao: 'Salários', valor: 5000, empresa_id: 9
    });

    expect(resultado.id).toBe(1);
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual(['pessoal', 'Salários', 5000, 9]);
  });
});

describe('atualizar', () => {
  test('updates only the provided fields, scoped to empresa_id and deletado_em IS NULL', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, valor: 200 }] });

    const resultado = await despesasFixasRepository.atualizar(1, { valor: 200 }, 9);

    expect(resultado).toEqual({ id: 1, valor: 200 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('valor = $1');
    expect(sql).toContain('WHERE id = $2 AND empresa_id = $3 AND deletado_em IS NULL');
    expect(params).toEqual([200, 1, 9]);
  });

  test('returns null when no row matches', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const resultado = await despesasFixasRepository.atualizar(999, { valor: 200 }, 9);

    expect(resultado).toBeNull();
  });
});

describe('deletar', () => {
  test('sets deletado_em, scoped to empresa_id and deletado_em IS NULL', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1 }] });

    const resultado = await despesasFixasRepository.deletar(1, 9);

    expect(resultado).toEqual({ id: 1 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('SET deletado_em = NOW()');
    expect(sql).toContain('WHERE id = $1 AND empresa_id = $2 AND deletado_em IS NULL');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when no row matches (already deleted or another empresa)', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const resultado = await despesasFixasRepository.deletar(999, 9);

    expect(resultado).toBeNull();
  });
});

describe('alternarAtivo', () => {
  test('flips ativo, scoped to empresa_id and deletado_em IS NULL', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, ativo: false }] });

    const resultado = await despesasFixasRepository.alternarAtivo(1, 9);

    expect(resultado).toEqual({ id: 1, ativo: false });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('SET ativo = NOT ativo');
    expect(params).toEqual([1, 9]);
  });
});

describe('somarAtivas', () => {
  test('sums only ativo = true and non-deleted despesas for the empresa', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ total: '6854.00' }] });

    const resultado = await despesasFixasRepository.somarAtivas(9);

    expect(resultado).toBe('6854.00');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('ativo = true');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([9]);
  });
});
