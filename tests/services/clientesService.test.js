jest.mock('../../src/repositories/clientesRepository');

const clientesRepository = require('../../src/repositories/clientesRepository');
const clientesService = require('../../src/services/clientesService');

beforeEach(() => {
  jest.clearAllMocks();
});

test('listar delegates to the repository', async () => {
  clientesRepository.listar.mockResolvedValue([{ id: 1 }]);

  await expect(clientesService.listar()).resolves.toEqual([{ id: 1 }]);
});

describe('historico', () => {
  test('throws 404 when there are no registros', async () => {
    clientesRepository.getHistorico.mockResolvedValue([]);

    await expect(clientesService.historico(1)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Nenhum histórico encontrado'
    });
  });

  test('returns the registros when present', async () => {
    clientesRepository.getHistorico.mockResolvedValue([{ venda_id: 1 }]);

    await expect(clientesService.historico(1)).resolves.toEqual([{ venda_id: 1 }]);
  });
});

describe('anonimizar', () => {
  test('delegates to the repository and returns only id/anonimizado/anonimizado_em', async () => {
    clientesRepository.anonimizar.mockResolvedValue({
      id: 1,
      nome: 'Cliente removido',
      telefone: null,
      email: null,
      ativo: false,
      anonimizado: true,
      anonimizado_em: '2026-09-06T00:00:00.000Z'
    });

    await expect(clientesService.anonimizar(1, 9)).resolves.toEqual({
      id: 1,
      anonimizado: true,
      anonimizado_em: '2026-09-06T00:00:00.000Z'
    });
    expect(clientesRepository.anonimizar).toHaveBeenCalledWith(1, 9);
  });

  test('propagates errors from the repository (404/409)', async () => {
    const AppError = require('../../src/errors/AppError');
    clientesRepository.anonimizar.mockRejectedValue(new AppError('Cliente já foi anonimizado', 409));

    await expect(clientesService.anonimizar(1, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cliente já foi anonimizado'
    });
  });
});

describe('totalGasto', () => {
  test('throws 404 when the cliente does not exist', async () => {
    clientesRepository.getTotalGasto.mockResolvedValue(null);

    await expect(clientesService.totalGasto(999)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Cliente não encontrado'
    });
  });

  test('returns the dados when the cliente exists', async () => {
    clientesRepository.getTotalGasto.mockResolvedValue({ id: 1, total_gasto: 100 });

    await expect(clientesService.totalGasto(1)).resolves.toEqual({ id: 1, total_gasto: 100 });
  });
});
