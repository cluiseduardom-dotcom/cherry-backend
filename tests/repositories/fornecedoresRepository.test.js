jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const fornecedoresRepository = require('../../src/repositories/fornecedoresRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listarPaginado', () => {
  test('filters by empresa_id even when no other filter is provided', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1, empresa_id: 9 }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const resultado = await fornecedoresRepository.listarPaginado({ limit: 20, offset: 0, empresa_id: 9 });

    expect(resultado).toEqual({ items: [{ id: 1, empresa_id: 9 }], total: 1 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE empresa_id = $1');
    expect(params).toEqual([9, 20, 0]);
  });

  test('applies a nome filter (ILIKE) alongside empresa_id', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await fornecedoresRepository.listarPaginado({ limit: 20, offset: 0, nome: 'Metais', empresa_id: 9 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('nome ILIKE $2');
    expect(params).toEqual([9, '%Metais%', 20, 0]);
  });
});

describe('buscarPorId', () => {
  test('scopes the lookup by id AND empresa_id in the same query', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, empresa_id: 9 }] });

    const resultado = await fornecedoresRepository.buscarPorId(1, 9);

    expect(resultado).toEqual({ id: 1, empresa_id: 9 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1 AND empresa_id = $2');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when no row matches id + empresa_id (e.g. fornecedor from another empresa)', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const resultado = await fornecedoresRepository.buscarPorId(1, 9);
    expect(resultado).toBeNull();
  });
});

describe('criar', () => {
  test('inserts with the given empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nome: 'Metais & Cia', empresa_id: 9 }] });

    const resultado = await fornecedoresRepository.criar({ nome: 'Metais & Cia', empresa_id: 9 });

    expect(resultado.empresa_id).toBe(9);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO fornecedores');
    expect(params).toEqual(['Metais & Cia', null, null, null, null, null, 9]);
  });
});

describe('atualizar', () => {
  test('scopes the update by id AND empresa_id, updating only provided fields', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nome: 'Novo Nome', empresa_id: 9 }] });

    const resultado = await fornecedoresRepository.atualizar(1, { nome: 'Novo Nome' }, 9);

    expect(resultado.nome).toBe('Novo Nome');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $2 AND empresa_id = $3');
    expect(params).toEqual(['Novo Nome', 1, 9]);
  });

  test('returns null when the fornecedor does not belong to this empresa', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const resultado = await fornecedoresRepository.atualizar(1, { nome: 'X' }, 9);
    expect(resultado).toBeNull();
  });
});

describe('desativar', () => {
  test('scopes the soft delete by id AND empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, ativo: false, empresa_id: 9 }] });

    const resultado = await fornecedoresRepository.desativar(1, 9);

    expect(resultado.ativo).toBe(false);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1 AND empresa_id = $2');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when the fornecedor does not belong to this empresa', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const resultado = await fornecedoresRepository.desativar(999, 9);
    expect(resultado).toBeNull();
  });
});
