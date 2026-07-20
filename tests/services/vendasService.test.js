jest.mock('../../src/repositories/vendasRepository');

const vendasRepository = require('../../src/repositories/vendasRepository');
const vendasService = require('../../src/services/vendasService');

beforeEach(() => {
  jest.clearAllMocks();
});

test('resumo delegates to the repository', async () => {
  vendasRepository.getResumo.mockResolvedValue({ total_vendas: 2 });

  await expect(vendasService.resumo()).resolves.toEqual({ total_vendas: 2 });
});

describe('criar', () => {
  test('computes the total from itens and passes it to the repository', async () => {
    const itens = [
      { produto_id: 1, quantidade: 2, preco_unitario: 10 },
      { produto_id: 2, quantidade: 1, preco_unitario: 5.5 }
    ];
    vendasRepository.criar.mockResolvedValue({ id: 1, cliente_id: 7, total: 25.5 });

    const result = await vendasService.criar(7, itens);

    expect(vendasRepository.criar).toHaveBeenCalledWith({
      cliente_id: 7,
      itens,
      total: 25.5
    });
    expect(result).toEqual({ id: 1, cliente_id: 7, total: 25.5 });
  });

  test('propagates errors from the repository (e.g. a failed transaction)', async () => {
    vendasRepository.criar.mockRejectedValue(new Error('db failure'));

    await expect(
      vendasService.criar(1, [{ produto_id: 1, quantidade: 1, preco_unitario: 10 }])
    ).rejects.toThrow('db failure');
  });
});
