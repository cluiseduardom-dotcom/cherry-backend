jest.mock('../../src/repositories/categoriasRepository');

const categoriasRepository = require('../../src/repositories/categoriasRepository');
const categoriasService = require('../../src/services/categoriasService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('paginates and forwards empresa_id', async () => {
    categoriasRepository.listarPaginado.mockResolvedValue({ items: [{ id: 1 }], total: 1 });

    const result = await categoriasService.listar({ page: 1, pageSize: 20 }, 9);

    expect(categoriasRepository.listarPaginado).toHaveBeenCalledWith({ limit: 20, offset: 0, empresa_id: 9 });
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  test('computes the correct offset for page > 1', async () => {
    categoriasRepository.listarPaginado.mockResolvedValue({ items: [], total: 0 });

    await categoriasService.listar({ page: 3, pageSize: 10 }, 9);

    expect(categoriasRepository.listarPaginado).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20, empresa_id: 9 })
    );
  });
});

describe('criar', () => {
  test('uppercases codigo and creates when no duplicate exists', async () => {
    categoriasRepository.buscarPorCodigoNivel.mockResolvedValue(null);
    categoriasRepository.criar.mockResolvedValue({ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco', empresa_id: 9 });

    const result = await categoriasService.criar({ nivel: 1, codigo: 'br', nome: 'Brinco' }, 9);

    expect(categoriasRepository.buscarPorCodigoNivel).toHaveBeenCalledWith(1, 'BR', 9);
    expect(categoriasRepository.criar).toHaveBeenCalledWith({ nivel: 1, codigo: 'BR', nome: 'Brinco', empresa_id: 9 });
    expect(result.codigo).toBe('BR');
  });

  test('throws 409 when the codigo is already taken at this nivel', async () => {
    categoriasRepository.buscarPorCodigoNivel.mockResolvedValue({ id: 1 });

    await expect(
      categoriasService.criar({ nivel: 1, codigo: 'BR', nome: 'Brinco' }, 9)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Já existe uma categoria com esse código neste nível' });

    expect(categoriasRepository.criar).not.toHaveBeenCalled();
  });

  test('converts a unique-violation race on insert into a clean 409', async () => {
    categoriasRepository.buscarPorCodigoNivel.mockResolvedValue(null);
    const erroColisao = new Error('duplicate key value violates unique constraint "idx_categorias_produto_codigo_unico"');
    erroColisao.code = '23505';
    categoriasRepository.criar.mockRejectedValue(erroColisao);

    await expect(
      categoriasService.criar({ nivel: 1, codigo: 'BR', nome: 'Brinco' }, 9)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Já existe uma categoria com esse código neste nível' });
  });
});

describe('atualizar', () => {
  test('updates nome via the repository', async () => {
    categoriasRepository.atualizarNome.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const result = await categoriasService.atualizar(1, { nome: 'Novo Nome' }, 9);

    expect(categoriasRepository.atualizarNome).toHaveBeenCalledWith(1, 'Novo Nome', 9);
    expect(result.nome).toBe('Novo Nome');
  });

  test('throws 404 when the categoria does not exist for this empresa', async () => {
    categoriasRepository.atualizarNome.mockResolvedValue(null);

    await expect(categoriasService.atualizar(999, { nome: 'X' }, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Categoria não encontrada'
    });
  });
});

describe('remover', () => {
  test('soft-deletes an existing categoria', async () => {
    categoriasRepository.softDelete.mockResolvedValue({ id: 1, deletado_em: '2026-09-12T00:00:00.000Z' });

    const result = await categoriasService.remover(1, 9);

    expect(categoriasRepository.softDelete).toHaveBeenCalledWith(1, 9);
    expect(result.deletado_em).toBeTruthy();
  });

  test('throws 404 when the categoria does not exist for this empresa', async () => {
    categoriasRepository.softDelete.mockResolvedValue(null);

    await expect(categoriasService.remover(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Categoria não encontrada'
    });
  });
});
