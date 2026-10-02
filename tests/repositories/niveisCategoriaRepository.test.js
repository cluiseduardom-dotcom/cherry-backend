jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const niveisCategoriaRepository = require('../../src/repositories/niveisCategoriaRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('scopes by empresa_id and orders by nivel ascending', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 1, nome: 'Família' }] });

    const resultado = await niveisCategoriaRepository.listar(9);

    expect(resultado).toEqual([{ id: 1, nivel: 1, nome: 'Família' }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('ORDER BY nivel ASC');
    expect(sql).not.toContain('categorias_produto');
    expect(params).toEqual([9]);
  });
});

describe('buscarPorId', () => {
  test('scopes by id AND empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, empresa_id: 9 }] });

    const resultado = await niveisCategoriaRepository.buscarPorId(1, 9);

    expect(resultado).toEqual({ id: 1, empresa_id: 9 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1 AND empresa_id = $2');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when no row matches', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await niveisCategoriaRepository.buscarPorId(1, 9)).toBeNull();
  });
});

describe('buscarPorNivel', () => {
  test('scopes by nivel and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 2 }] });

    const resultado = await niveisCategoriaRepository.buscarPorNivel(2, 9);

    expect(resultado).toEqual({ id: 1, nivel: 2 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('nivel = $1 AND empresa_id = $2');
    expect(params).toEqual([2, 9]);
  });

  test('returns null when nothing matches', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await niveisCategoriaRepository.buscarPorNivel(9, 9)).toBeNull();
  });
});

describe('criar', () => {
  test('inserts with the given empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 1, nome: 'Família', empresa_id: 9 }] });

    const resultado = await niveisCategoriaRepository.criar({ nivel: 1, nome: 'Família', empresa_id: 9 });

    expect(resultado.empresa_id).toBe(9);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO niveis_categoria');
    expect(params).toEqual([1, 'Família', 9]);
  });
});

describe('atualizarNome', () => {
  test('updates nome scoped by id and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nome: 'Novo Nome' }] });

    const resultado = await niveisCategoriaRepository.atualizarNome(1, 'Novo Nome', 9);

    expect(resultado.nome).toBe('Novo Nome');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('atualizado_em = NOW()');
    expect(params).toEqual(['Novo Nome', 1, 9]);
  });

  test('returns null when the nivel does not belong to this empresa', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await niveisCategoriaRepository.atualizarNome(1, 'X', 9)).toBeNull();
  });
});

describe('remover', () => {
  test('deletes scoped by id and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 1, nome: 'Família' }] });

    const resultado = await niveisCategoriaRepository.remover(1, 9);

    expect(resultado).toEqual({ id: 1, nivel: 1, nome: 'Família' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('DELETE FROM niveis_categoria');
    expect(sql).toContain('WHERE id = $1 AND empresa_id = $2');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when not found', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await niveisCategoriaRepository.remover(1, 9)).toBeNull();
  });
});
