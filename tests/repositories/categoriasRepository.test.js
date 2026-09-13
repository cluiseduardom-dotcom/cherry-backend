jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const categoriasRepository = require('../../src/repositories/categoriasRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listarPaginado', () => {
  test('filters by empresa_id and excludes soft-deleted rows', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const resultado = await categoriasRepository.listarPaginado({ limit: 20, offset: 0, empresa_id: 9 });

    expect(resultado).toEqual({ items: [{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }], total: 1 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([9, 20, 0]);
  });
});

describe('buscarPorId', () => {
  test('scopes by id AND empresa_id and excludes soft-deleted rows', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, empresa_id: 9 }] });

    const resultado = await categoriasRepository.buscarPorId(1, 9);

    expect(resultado).toEqual({ id: 1, empresa_id: 9 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1 AND empresa_id = $2');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when no row matches', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await categoriasRepository.buscarPorId(1, 9)).toBeNull();
  });
});

describe('buscarPorCodigoNivel', () => {
  test('compares codigo case-insensitively, scoped by nivel and empresa_id, active only', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, codigo: 'BR' }] });

    const resultado = await categoriasRepository.buscarPorCodigoNivel(1, 'BR', 9);

    expect(resultado).toEqual({ id: 1, codigo: 'BR' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('UPPER(codigo)');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([1, 'BR', 9]);
  });

  test('returns null when nothing matches', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await categoriasRepository.buscarPorCodigoNivel(1, 'ZZ', 9)).toBeNull();
  });
});

describe('buscarPorIds', () => {
  test('returns active rows matching the given ids and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });

    const resultado = await categoriasRepository.buscarPorIds([1, 2], 9);

    expect(resultado).toEqual([{ id: 1 }, { id: 2 }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([[1, 2], 9]);
  });

  test('returns an empty array without querying when ids is empty', async () => {
    db.query = jest.fn();
    expect(await categoriasRepository.buscarPorIds([], 9)).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('criar', () => {
  test('inserts with the given empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco', empresa_id: 9 }] });

    const resultado = await categoriasRepository.criar({ nivel: 1, codigo: 'BR', nome: 'Brinco', empresa_id: 9 });

    expect(resultado.empresa_id).toBe(9);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO categorias_produto');
    expect(params).toEqual([1, 'BR', 'Brinco', 9]);
  });
});

describe('atualizarNome', () => {
  test('updates nome scoped by id, empresa_id, and only active rows', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nome: 'Novo Nome' }] });

    const resultado = await categoriasRepository.atualizarNome(1, 'Novo Nome', 9);

    expect(resultado.nome).toBe('Novo Nome');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual(['Novo Nome', 1, 9]);
  });

  test('returns null when the categoria does not belong to this empresa or is deleted', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await categoriasRepository.atualizarNome(1, 'X', 9)).toBeNull();
  });
});

describe('softDelete', () => {
  test('sets deletado_em scoped by id and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, deletado_em: '2026-09-12T00:00:00.000Z' }] });

    const resultado = await categoriasRepository.softDelete(1, 9);

    expect(resultado.deletado_em).toBeTruthy();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('deletado_em = NOW()');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when already deleted or not found', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await categoriasRepository.softDelete(1, 9)).toBeNull();
  });
});
