jest.mock('../../src/repositories/fornecedoresRepository');

const fornecedoresRepository = require('../../src/repositories/fornecedoresRepository');
const fornecedoresService = require('../../src/services/fornecedoresService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('paginates and forwards the nome filter, scoped to empresa_id', async () => {
    fornecedoresRepository.listarPaginado.mockResolvedValue({
      items: [{ id: 1, nome: 'Metais & Cia' }],
      total: 1
    });

    const result = await fornecedoresService.listar({ page: 1, pageSize: 20, nome: 'Metais' }, 9);

    expect(fornecedoresRepository.listarPaginado).toHaveBeenCalledWith({
      limit: 20, offset: 0, nome: 'Metais', empresa_id: 9
    });
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(result.items).toHaveLength(1);
  });

  test('computes the correct offset for page > 1', async () => {
    fornecedoresRepository.listarPaginado.mockResolvedValue({ items: [], total: 0 });

    await fornecedoresService.listar({ page: 3, pageSize: 10 }, 9);

    expect(fornecedoresRepository.listarPaginado).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20, empresa_id: 9 })
    );
  });
});

describe('buscarPorId', () => {
  test('throws 404 when the fornecedor does not exist for this empresa', async () => {
    fornecedoresRepository.buscarPorId.mockResolvedValue(null);

    await expect(fornecedoresService.buscarPorId(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Fornecedor não encontrado'
    });
    expect(fornecedoresRepository.buscarPorId).toHaveBeenCalledWith(999, 9);
  });

  test('returns the fornecedor when found', async () => {
    fornecedoresRepository.buscarPorId.mockResolvedValue({ id: 1, nome: 'Metais & Cia' });

    const result = await fornecedoresService.buscarPorId(1, 9);
    expect(result).toEqual({ id: 1, nome: 'Metais & Cia' });
  });
});

describe('criar', () => {
  test('attaches empresa_id and delegates to the repository', async () => {
    fornecedoresRepository.criar.mockResolvedValue({ id: 1, nome: 'Metais & Cia', empresa_id: 9 });

    const result = await fornecedoresService.criar({ nome: 'Metais & Cia' }, 9);

    expect(fornecedoresRepository.criar).toHaveBeenCalledWith({ nome: 'Metais & Cia', empresa_id: 9 });
    expect(result.id).toBe(1);
  });
});

describe('atualizar', () => {
  test('checks existence within the empresa before delegating the update', async () => {
    fornecedoresRepository.buscarPorId.mockResolvedValue({ id: 1, empresa_id: 9 });
    fornecedoresRepository.atualizar.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const result = await fornecedoresService.atualizar(1, { nome: 'Novo Nome' }, 9);

    expect(fornecedoresRepository.buscarPorId).toHaveBeenCalledWith(1, 9);
    expect(fornecedoresRepository.atualizar).toHaveBeenCalledWith(1, { nome: 'Novo Nome' }, 9);
    expect(result.nome).toBe('Novo Nome');
  });

  test('throws 404 without updating when the fornecedor does not belong to this empresa', async () => {
    fornecedoresRepository.buscarPorId.mockResolvedValue(null);

    await expect(fornecedoresService.atualizar(999, { nome: 'X' }, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Fornecedor não encontrado'
    });
    expect(fornecedoresRepository.atualizar).not.toHaveBeenCalled();
  });
});

describe('remover', () => {
  test('soft-deletes (ativo = false) an existing fornecedor', async () => {
    fornecedoresRepository.buscarPorId.mockResolvedValue({ id: 1, empresa_id: 9 });
    fornecedoresRepository.desativar.mockResolvedValue({ id: 1, ativo: false });

    const result = await fornecedoresService.remover(1, 9);

    expect(fornecedoresRepository.desativar).toHaveBeenCalledWith(1, 9);
    expect(result.ativo).toBe(false);
  });

  test('throws 404 without deactivating when the fornecedor does not belong to this empresa', async () => {
    fornecedoresRepository.buscarPorId.mockResolvedValue(null);

    await expect(fornecedoresService.remover(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Fornecedor não encontrado'
    });
    expect(fornecedoresRepository.desativar).not.toHaveBeenCalled();
  });
});
