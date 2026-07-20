jest.mock('../../src/repositories/produtosRepository');

const produtosRepository = require('../../src/repositories/produtosRepository');
const produtosService = require('../../src/services/produtosService');

beforeEach(() => {
  jest.clearAllMocks();
});

test('listar delegates to the repository', async () => {
  produtosRepository.listar.mockResolvedValue([{ id: 1 }]);

  await expect(produtosService.listar()).resolves.toEqual([{ id: 1 }]);
});

test('criar delegates to the repository with the given data', async () => {
  const dados = { nome: 'X', preco_venda: 10, custo: 5 };
  produtosRepository.criar.mockResolvedValue({ id: 1, ...dados });

  await produtosService.criar(dados);

  expect(produtosRepository.criar).toHaveBeenCalledWith(dados);
});

describe('ajustarPreco', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(produtosService.ajustarPreco(999, 0.1)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Produto não encontrado'
    });

    expect(produtosRepository.ajustarPreco).not.toHaveBeenCalled();
  });

  test('adjusts the price when the produto exists', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
    produtosRepository.ajustarPreco.mockResolvedValue({ id: 1, preco_venda: 11 });

    const result = await produtosService.ajustarPreco(1, 0.1);

    expect(produtosRepository.ajustarPreco).toHaveBeenCalledWith(1, 0.1);
    expect(result).toEqual({ id: 1, preco_venda: 11 });
  });
});

test('dashboard delegates to the repository', async () => {
  produtosRepository.getDashboard.mockResolvedValue({ total_vendas: 3 });

  await expect(produtosService.dashboard()).resolves.toEqual({ total_vendas: 3 });
});
