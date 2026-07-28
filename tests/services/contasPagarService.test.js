jest.mock('../../src/repositories/contasPagarRepository');

const contasPagarRepository = require('../../src/repositories/contasPagarRepository');
const contasPagarService = require('../../src/services/contasPagarService');
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
    contasPagarRepository.buscarPorId.mockResolvedValue({
      id: 1, status: 'pendente', data_vencimento: '2026-07-20'
    });

    const result = await contasPagarService.buscarPorId(1);

    expect(result.atrasado).toBe(true);
  });

  test('is false for a pendente conta with vencimento today', async () => {
    contasPagarRepository.buscarPorId.mockResolvedValue({
      id: 1, status: 'pendente', data_vencimento: '2026-07-27'
    });

    const result = await contasPagarService.buscarPorId(1);

    expect(result.atrasado).toBe(false);
  });

  test('is false for a pendente conta with vencimento in the future', async () => {
    contasPagarRepository.buscarPorId.mockResolvedValue({
      id: 1, status: 'pendente', data_vencimento: '2026-08-01'
    });

    const result = await contasPagarService.buscarPorId(1);

    expect(result.atrasado).toBe(false);
  });

  test('is false for an overdue-by-date conta that is already paga', async () => {
    contasPagarRepository.buscarPorId.mockResolvedValue({
      id: 1, status: 'pago', data_vencimento: '2026-07-20'
    });

    const result = await contasPagarService.buscarPorId(1);

    expect(result.atrasado).toBe(false);
  });

  test('is false for an overdue-by-date conta that is cancelada', async () => {
    contasPagarRepository.buscarPorId.mockResolvedValue({
      id: 1, status: 'cancelado', data_vencimento: '2026-07-20'
    });

    const result = await contasPagarService.buscarPorId(1);

    expect(result.atrasado).toBe(false);
  });
});

describe('listar', () => {
  test('paginates and forwards filters to the repository', async () => {
    contasPagarRepository.listarPaginado.mockResolvedValue({
      items: [{ id: 1, status: 'pendente', data_vencimento: '2026-08-01' }],
      total: 1
    });

    const result = await contasPagarService.listar({
      page: 1, pageSize: 20, status: 'pendente', vencimentoDe: undefined, vencimentoAte: undefined
    });

    expect(contasPagarRepository.listarPaginado).toHaveBeenCalledWith({
      limit: 20, offset: 0, status: 'pendente', vencimentoDe: undefined, vencimentoAte: undefined
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toHaveProperty('atrasado');
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  test('computes the correct offset for page > 1', async () => {
    contasPagarRepository.listarPaginado.mockResolvedValue({ items: [], total: 0 });

    await contasPagarService.listar({ page: 3, pageSize: 10 });

    expect(contasPagarRepository.listarPaginado).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 })
    );
  });
});

describe('buscarPorId', () => {
  test('throws 404 when the conta does not exist', async () => {
    contasPagarRepository.buscarPorId.mockResolvedValue(null);

    await expect(contasPagarService.buscarPorId(999)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Conta a pagar não encontrada'
    });
  });
});

describe('criar', () => {
  test('attaches the usuario_id responsável and delegates to the repository', async () => {
    contasPagarRepository.criar.mockResolvedValue({
      id: 1, descricao: 'Aluguel', valor: '1500.00', status: 'pendente', data_vencimento: '2026-08-10'
    });

    const result = await contasPagarService.criar(
      { descricao: 'Aluguel', valor: 1500, data_vencimento: new Date('2026-08-10') },
      7
    );

    expect(contasPagarRepository.criar).toHaveBeenCalledWith({
      descricao: 'Aluguel', valor: 1500, data_vencimento: new Date('2026-08-10'), usuario_id: 7
    });
    expect(result.id).toBe(1);
  });
});

describe('atualizar', () => {
  test('throws 404 when the conta does not exist', async () => {
    contasPagarRepository.buscarPorId.mockResolvedValue(null);

    await expect(contasPagarService.atualizar(999, { valor: 200 })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Conta a pagar não encontrada'
    });
    expect(contasPagarRepository.atualizar).not.toHaveBeenCalled();
  });

  test('delegates to the repository when the conta exists', async () => {
    contasPagarRepository.buscarPorId.mockResolvedValue({ id: 1, status: 'pendente', data_vencimento: '2026-08-10' });
    contasPagarRepository.atualizar.mockResolvedValue({
      id: 1, valor: '200.00', status: 'pendente', data_vencimento: '2026-08-10'
    });

    const result = await contasPagarService.atualizar(1, { valor: 200 });

    expect(contasPagarRepository.atualizar).toHaveBeenCalledWith(1, { valor: 200 });
    expect(result.valor).toBe('200.00');
  });
});

describe('marcarComoPaga', () => {
  test('delegates the guarded transition to the repository', async () => {
    contasPagarRepository.marcarComoPaga.mockResolvedValue({
      id: 1, status: 'pago', data_vencimento: '2026-08-10', data_pagamento: '2026-07-27'
    });

    const result = await contasPagarService.marcarComoPaga(1);

    expect(contasPagarRepository.marcarComoPaga).toHaveBeenCalledWith(1);
    expect(result.status).toBe('pago');
  });

  test('propagates the 409 thrown by the repository when the conta is not pendente', async () => {
    contasPagarRepository.marcarComoPaga.mockRejectedValue(
      new AppError('Somente contas pendentes podem ser marcadas como pagas', 409)
    );

    await expect(contasPagarService.marcarComoPaga(1)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Somente contas pendentes podem ser marcadas como pagas'
    });
  });
});

describe('cancelar', () => {
  test('delegates the guarded transition to the repository', async () => {
    contasPagarRepository.cancelar.mockResolvedValue({
      id: 1, status: 'cancelado', data_vencimento: '2026-08-10'
    });

    const result = await contasPagarService.cancelar(1);

    expect(contasPagarRepository.cancelar).toHaveBeenCalledWith(1);
    expect(result.status).toBe('cancelado');
  });

  test('propagates the 409 thrown by the repository when the conta is not pendente', async () => {
    contasPagarRepository.cancelar.mockRejectedValue(
      new AppError('Somente contas pendentes podem ser canceladas', 409)
    );

    await expect(contasPagarService.cancelar(1)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Somente contas pendentes podem ser canceladas'
    });
  });
});
