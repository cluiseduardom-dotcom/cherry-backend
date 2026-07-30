jest.mock('../../src/repositories/contasReceberRepository');

const contasReceberRepository = require('../../src/repositories/contasReceberRepository');
const contasReceberService = require('../../src/services/contasReceberService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('atrasado (campo calculado)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('is true for a pendente conta with vencimento in the past', async () => {
    contasReceberRepository.buscarPorId.mockResolvedValue({
      id: 1, status: 'pendente', data_vencimento: '2026-07-20'
    });

    const result = await contasReceberService.buscarPorId(1, 9);

    expect(result.atrasado).toBe(true);
  });

  test('is false for a pendente conta with vencimento today', async () => {
    contasReceberRepository.buscarPorId.mockResolvedValue({
      id: 1, status: 'pendente', data_vencimento: '2026-07-27'
    });

    const result = await contasReceberService.buscarPorId(1, 9);

    expect(result.atrasado).toBe(false);
  });

  test('is false for an overdue-by-date conta that is already recebida', async () => {
    contasReceberRepository.buscarPorId.mockResolvedValue({
      id: 1, status: 'recebido', data_vencimento: '2026-07-20'
    });

    const result = await contasReceberService.buscarPorId(1, 9);

    expect(result.atrasado).toBe(false);
  });

  test('is false for an overdue-by-date conta that is cancelada', async () => {
    contasReceberRepository.buscarPorId.mockResolvedValue({
      id: 1, status: 'cancelado', data_vencimento: '2026-07-20'
    });

    const result = await contasReceberService.buscarPorId(1, 9);

    expect(result.atrasado).toBe(false);
  });
});

describe('listar', () => {
  test('paginates and forwards filters to the repository', async () => {
    contasReceberRepository.listarPaginado.mockResolvedValue({
      items: [{ id: 1, status: 'pendente', data_vencimento: '2026-08-01' }],
      total: 1
    });

    const result = await contasReceberService.listar({
      page: 1, pageSize: 20, status: 'pendente', vencimentoDe: undefined, vencimentoAte: undefined
    }, 9);

    expect(contasReceberRepository.listarPaginado).toHaveBeenCalledWith({
      limit: 20, offset: 0, status: 'pendente', vencimentoDe: undefined, vencimentoAte: undefined, empresa_id: 9
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toHaveProperty('atrasado');
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  test('computes the correct offset for page > 1', async () => {
    contasReceberRepository.listarPaginado.mockResolvedValue({ items: [], total: 0 });

    await contasReceberService.listar({ page: 3, pageSize: 10 }, 9);

    expect(contasReceberRepository.listarPaginado).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 })
    );
  });
});

describe('buscarPorId', () => {
  test('throws 404 when the conta does not exist', async () => {
    contasReceberRepository.buscarPorId.mockResolvedValue(null);

    await expect(contasReceberService.buscarPorId(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Conta a receber não encontrada'
    });
  });
});

describe('marcarComoRecebida', () => {
  test('delegates the guarded transition to the repository', async () => {
    contasReceberRepository.marcarComoRecebida.mockResolvedValue({
      id: 1, status: 'recebido', data_vencimento: '2026-08-10', data_recebimento: '2026-07-27'
    });

    const result = await contasReceberService.marcarComoRecebida(1, 9);

    expect(contasReceberRepository.marcarComoRecebida).toHaveBeenCalledWith(1, 9);
    expect(result.status).toBe('recebido');
  });

  test('propagates the 409 thrown by the repository when the conta is not pendente', async () => {
    contasReceberRepository.marcarComoRecebida.mockRejectedValue(
      new AppError('Somente contas pendentes podem ser marcadas como recebidas', 409)
    );

    await expect(contasReceberService.marcarComoRecebida(1, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Somente contas pendentes podem ser marcadas como recebidas'
    });
  });
});
