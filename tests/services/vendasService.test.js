jest.mock('../../src/repositories/vendasRepository');
jest.mock('../../src/repositories/precosRepository');

const vendasRepository = require('../../src/repositories/vendasRepository');
const precosRepository = require('../../src/repositories/precosRepository');
const vendasService = require('../../src/services/vendasService');

beforeEach(() => {
  jest.clearAllMocks();
});

test('resumo delegates to the repository', async () => {
  vendasRepository.getResumo.mockResolvedValue({ total_vendas: 2 });

  await expect(vendasService.resumo()).resolves.toEqual({ total_vendas: 2 });
});

describe('criar', () => {
  test('resolves the canal and delegates to the repository, defaulting cliente_id to null', async () => {
    precosRepository.buscarCanalPorNome.mockResolvedValue({ id: 1, nome: 'loja_fisica' });
    vendasRepository.criar.mockResolvedValue({ id: 1, total: '30.00' });

    const result = await vendasService.criar({ itens: [{ produto_id: 1, quantidade: 3 }] }, 7, 9);

    expect(precosRepository.buscarCanalPorNome).toHaveBeenCalledWith('loja_fisica', 9);
    expect(vendasRepository.criar).toHaveBeenCalledWith({
      cliente_id: null,
      canal_id: 1,
      usuario_id: 7,
      empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 3 }]
    });
    expect(result).toEqual({ id: 1, total: '30.00' });
  });

  test('passes an explicit canal and cliente_id through', async () => {
    precosRepository.buscarCanalPorNome.mockResolvedValue({ id: 2, nome: 'online' });
    vendasRepository.criar.mockResolvedValue({ id: 1 });

    await vendasService.criar({ cliente_id: 5, canal: 'online', itens: [{ produto_id: 1, quantidade: 1 }] }, 7, 9);

    expect(precosRepository.buscarCanalPorNome).toHaveBeenCalledWith('online', 9);
    expect(vendasRepository.criar).toHaveBeenCalledWith({
      cliente_id: 5,
      canal_id: 2,
      usuario_id: 7,
      empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 1 }]
    });
  });

  test('passes forma_pagamento and dias_prazo through to the repository', async () => {
    precosRepository.buscarCanalPorNome.mockResolvedValue({ id: 1, nome: 'loja_fisica' });
    vendasRepository.criar.mockResolvedValue({ id: 1, total: '10.00' });

    await vendasService.criar({
      forma_pagamento: 'prazo',
      dias_prazo: 30,
      itens: [{ produto_id: 1, quantidade: 1 }]
    }, 7, 9);

    expect(vendasRepository.criar).toHaveBeenCalledWith(expect.objectContaining({
      forma_pagamento: 'prazo',
      dias_prazo: 30
    }));
  });

  test('throws 400 for an invalid canal', async () => {
    precosRepository.buscarCanalPorNome.mockResolvedValue(null);

    await expect(
      vendasService.criar({ canal: 'inexistente', itens: [{ produto_id: 1, quantidade: 1 }] }, 7)
    ).rejects.toMatchObject({ statusCode: 400, message: 'Canal inválido' });

    expect(vendasRepository.criar).not.toHaveBeenCalled();
  });

  test('propagates errors from the repository (e.g. a rolled-back transaction)', async () => {
    precosRepository.buscarCanalPorNome.mockResolvedValue({ id: 1, nome: 'loja_fisica' });
    vendasRepository.criar.mockRejectedValue(new Error('db failure'));

    await expect(
      vendasService.criar({ itens: [{ produto_id: 1, quantidade: 1 }] }, 1)
    ).rejects.toThrow('db failure');
  });
});

describe('listar', () => {
  test('does not filter by usuario_id for an admin', async () => {
    vendasRepository.listarPaginado.mockResolvedValue({ items: [{ id: 1 }, { id: 2 }], total: 2 });

    const result = await vendasService.listar({ page: 1, pageSize: 20 }, { id: 1, role: 'admin', empresa_id: 9 });

    expect(vendasRepository.listarPaginado).toHaveBeenCalledWith({ limit: 20, offset: 0, usuario_id: undefined, empresa_id: 9 });
    expect(result).toEqual({ items: [{ id: 1 }, { id: 2 }], page: 1, pageSize: 20, total: 2, totalPages: 1 });
  });

  test('filters by usuario_id for a vendedor (sees only their own vendas)', async () => {
    vendasRepository.listarPaginado.mockResolvedValue({ items: [{ id: 1 }], total: 1 });

    await vendasService.listar({ page: 1, pageSize: 20 }, { id: 42, role: 'vendedor', empresa_id: 9 });

    expect(vendasRepository.listarPaginado).toHaveBeenCalledWith({ limit: 20, offset: 0, usuario_id: 42, empresa_id: 9 });
  });

  test('computes the correct offset for page > 1', async () => {
    vendasRepository.listarPaginado.mockResolvedValue({ items: [], total: 0 });

    await vendasService.listar({ page: 3, pageSize: 10 }, { id: 1, role: 'admin', empresa_id: 9 });

    expect(vendasRepository.listarPaginado).toHaveBeenCalledWith({ limit: 10, offset: 20, usuario_id: undefined, empresa_id: 9 });
  });
});

describe('buscarPorId', () => {
  test('throws 404 when the venda does not exist', async () => {
    vendasRepository.buscarPorId.mockResolvedValue(null);

    await expect(vendasService.buscarPorId(999, { id: 1, role: 'admin' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Venda não encontrada'
    });
  });

  test('returns the venda for an admin regardless of ownership', async () => {
    vendasRepository.buscarPorId.mockResolvedValue({ id: 1, usuario_id: 99, itens: [] });

    const result = await vendasService.buscarPorId(1, { id: 1, role: 'admin' });

    expect(result).toEqual({ id: 1, usuario_id: 99, itens: [] });
  });

  test('returns the venda for a vendedor who owns it', async () => {
    vendasRepository.buscarPorId.mockResolvedValue({ id: 1, usuario_id: 42, itens: [] });

    const result = await vendasService.buscarPorId(1, { id: 42, role: 'vendedor' });

    expect(result.id).toBe(1);
  });

  test('throws 404 (not 403) for a vendedor viewing someone else\'s venda', async () => {
    vendasRepository.buscarPorId.mockResolvedValue({ id: 1, usuario_id: 99, itens: [] });

    await expect(vendasService.buscarPorId(1, { id: 42, role: 'vendedor' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Venda não encontrada'
    });
  });
});

describe('cancelar', () => {
  test('delegates to the repository', async () => {
    vendasRepository.cancelar.mockResolvedValue({ id: 1, status: 'cancelada' });

    const result = await vendasService.cancelar(1, 7, 9);

    expect(vendasRepository.cancelar).toHaveBeenCalledWith(1, 7, 9);
    expect(result).toEqual({ id: 1, status: 'cancelada' });
  });

  test('propagates a 409 when the venda is not finalizada', async () => {
    vendasRepository.cancelar.mockRejectedValue(
      Object.assign(new Error('Somente vendas finalizadas podem ser canceladas'), { statusCode: 409 })
    );

    await expect(vendasService.cancelar(1, 7, 9)).rejects.toMatchObject({ statusCode: 409 });
  });
});
