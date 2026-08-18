jest.mock('../../src/repositories/comprasRepository');

const comprasRepository = require('../../src/repositories/comprasRepository');
const comprasService = require('../../src/services/comprasService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('criar', () => {
  test('attaches usuario_id and empresa_id and delegates to the repository', async () => {
    comprasRepository.criar.mockResolvedValue({ id: 1, valor_total: 100, conta_pagar: null });

    const dados = { fornecedor_id: 3, data_compra: '2026-08-10', itens: [{ produto_id: 1, quantidade: 2, custo_unitario: 50 }] };
    const resultado = await comprasService.criar(dados, 7, 9);

    expect(comprasRepository.criar).toHaveBeenCalledWith({ ...dados, usuario_id: 7, empresa_id: 9 });
    expect(resultado.id).toBe(1);
  });
});

describe('listar', () => {
  test('paginates and forwards filters to the repository', async () => {
    comprasRepository.listarPaginado.mockResolvedValue({
      items: [{ id: 1, fornecedor_id: 3 }],
      total: 1
    });

    const result = await comprasService.listar({
      page: 1, pageSize: 20, fornecedor_id: 3, dataDe: undefined, dataAte: undefined
    }, 9);

    expect(comprasRepository.listarPaginado).toHaveBeenCalledWith({
      limit: 20, offset: 0, fornecedor_id: 3, dataDe: undefined, dataAte: undefined, empresa_id: 9
    });
    expect(result.items).toHaveLength(1);
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  test('computes the correct offset for page > 1', async () => {
    comprasRepository.listarPaginado.mockResolvedValue({ items: [], total: 0 });

    await comprasService.listar({ page: 3, pageSize: 10 }, 9);

    expect(comprasRepository.listarPaginado).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20, empresa_id: 9 })
    );
  });
});

describe('buscarPorId', () => {
  test('throws 404 when the compra does not exist', async () => {
    comprasRepository.buscarPorId.mockResolvedValue(null);

    await expect(comprasService.buscarPorId(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Compra não encontrada'
    });
  });

  test('returns the compra when found', async () => {
    comprasRepository.buscarPorId.mockResolvedValue({ id: 1, fornecedor_id: 3 });

    const result = await comprasService.buscarPorId(1, 9);
    expect(result).toEqual({ id: 1, fornecedor_id: 3 });
  });
});

describe('cancelar', () => {
  test('delegates the guarded cancellation to the repository', async () => {
    comprasRepository.cancelar.mockResolvedValue({ id: 1, status: 'cancelado' });

    const result = await comprasService.cancelar(1, 7, 9);

    expect(comprasRepository.cancelar).toHaveBeenCalledWith(1, 7, 9);
    expect(result.status).toBe('cancelado');
  });

  test('propagates the 409 thrown by the repository when the linked conta a pagar is already paga', async () => {
    comprasRepository.cancelar.mockRejectedValue(
      new AppError('Compra com conta a pagar já paga não pode ser cancelada', 409)
    );

    await expect(comprasService.cancelar(1, 7, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Compra com conta a pagar já paga não pode ser cancelada'
    });
  });
});
