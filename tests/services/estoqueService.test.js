jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/repositories/produtosRepository');

const estoqueRepository = require('../../src/repositories/estoqueRepository');
const produtosRepository = require('../../src/repositories/produtosRepository');
const estoqueService = require('../../src/services/estoqueService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('registrarMovimentacao', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(
      estoqueService.registrarMovimentacao(999, { tipo: 'entrada', quantidade: 5 }, 1)
    ).rejects.toMatchObject({ statusCode: 404, message: 'Produto não encontrado' });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('throws 400 when the produto is inactive', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, ativo: false });

    await expect(
      estoqueService.registrarMovimentacao(1, { tipo: 'entrada', quantidade: 5 }, 1)
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('throws 409 when the repository reports insufficient stock', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, ativo: true });
    estoqueRepository.criarMovimentacao.mockResolvedValue({ erro: 'ESTOQUE_INSUFICIENTE' });

    await expect(
      estoqueService.registrarMovimentacao(1, { tipo: 'saida', quantidade: 999 }, 1)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Estoque insuficiente para essa saída' });
  });

  test('passes usuario_id through and returns the created movimentacao', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, ativo: true });
    estoqueRepository.criarMovimentacao.mockResolvedValue({
      movimentacao: { id: 1, produto_id: 1, tipo: 'entrada', quantidade: 5, estoque_resultante: 15 }
    });

    const result = await estoqueService.registrarMovimentacao(1, { tipo: 'entrada', quantidade: 5 }, 42, 7);

    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith({
      produto_id: 1,
      tipo: 'entrada',
      quantidade: 5,
      motivo: undefined,
      usuario_id: 42,
      empresa_id: 7
    });
    expect(result.estoque_resultante).toBe(15);
  });
});

describe('historicoPorProduto', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(estoqueService.historicoPorProduto(999, { page: 1, pageSize: 20 })).rejects.toMatchObject({
      statusCode: 404
    });
  });

  test('paginates the history', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
    estoqueRepository.listarPorProduto.mockResolvedValue({ items: [{ id: 1 }], total: 1 });

    const result = await estoqueService.historicoPorProduto(1, { page: 1, pageSize: 20 }, 7);

    expect(estoqueRepository.listarPorProduto).toHaveBeenCalledWith(1, 7, { limit: 20, offset: 0 });
    expect(result).toEqual({ items: [{ id: 1 }], page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });
});

test('alertasEstoqueBaixo delegates to the repository', async () => {
  estoqueRepository.getEstoqueBaixo.mockResolvedValue([{ id: 1, estoque_atual: 1, estoque_minimo: 5 }]);

  await expect(estoqueService.alertasEstoqueBaixo(7)).resolves.toEqual([
    { id: 1, estoque_atual: 1, estoque_minimo: 5 }
  ]);
  expect(estoqueRepository.getEstoqueBaixo).toHaveBeenCalledWith(7);
});
