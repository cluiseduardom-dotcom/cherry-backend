jest.mock('../../src/repositories/producoesRepository');

const producoesRepository = require('../../src/repositories/producoesRepository');
const producoesService = require('../../src/services/producoesService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => jest.clearAllMocks());

describe('criar', () => {
  test('attaches usuario_id and empresa_id and delegates to the repository', async () => {
    producoesRepository.criar.mockResolvedValue({ id: 1, quantidade_produzida: 10, parcial: false });

    const result = await producoesService.criar({ produto_id: 5, quantidade_solicitada: 10 }, 7, 9);

    expect(producoesRepository.criar).toHaveBeenCalledWith({ produto_id: 5, quantidade_solicitada: 10, usuario_id: 7, empresa_id: 9 });
    expect(result.id).toBe(1);
  });

  test('propagates the 409 thrown when there is no stock for even 1 unit', async () => {
    producoesRepository.criar.mockRejectedValue(new AppError('Estoque insuficiente para produzir ao menos uma unidade', 409));

    await expect(producoesService.criar({ produto_id: 5, quantidade_solicitada: 10 }, 7, 9))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('listar', () => {
  test('paginates and forwards filters to the repository', async () => {
    producoesRepository.listarPaginado.mockResolvedValue({ items: [{ id: 1 }], total: 1 });

    const result = await producoesService.listar({ page: 1, pageSize: 20, produto_id: 5 }, 9);

    expect(producoesRepository.listarPaginado).toHaveBeenCalledWith({
      limit: 20, offset: 0, produto_id: 5, dataDe: undefined, dataAte: undefined, empresa_id: 9
    });
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });
});

describe('buscarPorId', () => {
  test('throws 404 when the producao does not exist', async () => {
    producoesRepository.buscarPorId.mockResolvedValue(null);

    await expect(producoesService.buscarPorId(999, 9)).rejects.toMatchObject({ statusCode: 404, message: 'Produção não encontrada' });
  });

  test('returns the producao when found', async () => {
    producoesRepository.buscarPorId.mockResolvedValue({ id: 1, custo_total: 40 });

    const result = await producoesService.buscarPorId(1, 9);
    expect(result.custo_total).toBe(40);
  });
});

describe('cancelar', () => {
  test('delegates the guarded cancellation to the repository', async () => {
    producoesRepository.cancelar.mockResolvedValue({ id: 1, status: 'cancelada' });

    const result = await producoesService.cancelar(1, 7, 9);

    expect(producoesRepository.cancelar).toHaveBeenCalledWith(1, 7, 9);
    expect(result.status).toBe('cancelada');
  });
});
