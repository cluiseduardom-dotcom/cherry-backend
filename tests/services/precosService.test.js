jest.mock('../../src/repositories/precosRepository');
jest.mock('../../src/repositories/produtosRepository');

const precosRepository = require('../../src/repositories/precosRepository');
const produtosRepository = require('../../src/repositories/produtosRepository');
const precosService = require('../../src/services/precosService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('calcularPreco', () => {
  test('markup -> preco_venda: computes preco_venda from custo and markup_percentual', () => {
    const result = precosService.calcularPreco({ custo: 20, markup_percentual: 50 });

    expect(result.preco_venda).toBe(30);
    expect(result.markup_percentual).toBe(50);
    expect(result.margem_percentual).toBeCloseTo(33.33, 2);
  });

  test('preco_venda -> markup/margem: derives both from custo', () => {
    const result = precosService.calcularPreco({ custo: 20, preco_venda: 30 });

    expect(result.preco_venda).toBe(30);
    expect(result.markup_percentual).toBe(50);
    expect(result.margem_percentual).toBeCloseTo(33.33, 2);
  });

  test('rounds preco_venda to 2 decimal places', () => {
    const result = precosService.calcularPreco({ custo: 10, markup_percentual: 33.333 });

    expect(result.preco_venda).toBe(13.33);
  });
});

describe('definirPreco', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(
      precosService.definirPreco(999, 1, { markup_percentual: 50 }, 1)
    ).rejects.toMatchObject({ statusCode: 404, message: 'Produto não encontrado' });

    expect(precosRepository.inserirPreco).not.toHaveBeenCalled();
  });

  test('throws 404 when the canal does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, custo: '20.00' });
    precosRepository.buscarCanalPorId.mockResolvedValue(null);

    await expect(
      precosService.definirPreco(1, 999, { markup_percentual: 50 }, 1)
    ).rejects.toMatchObject({ statusCode: 404, message: 'Canal não encontrado' });

    expect(precosRepository.inserirPreco).not.toHaveBeenCalled();
  });

  test('blocks with 409 when the resulting preco_venda would be below custo (markup direction)', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, custo: '20.00' });
    precosRepository.buscarCanalPorId.mockResolvedValue({ id: 1, nome: 'loja_fisica' });

    await expect(
      precosService.definirPreco(1, 1, { markup_percentual: -50 }, 1)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Preço de venda não pode ser menor que o custo' });

    expect(precosRepository.inserirPreco).not.toHaveBeenCalled();
  });

  test('blocks with 409 when the resulting preco_venda would be below custo (preco_venda direction)', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, custo: '20.00' });
    precosRepository.buscarCanalPorId.mockResolvedValue({ id: 1, nome: 'loja_fisica' });

    await expect(
      precosService.definirPreco(1, 1, { preco_venda: 15 }, 1)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Preço de venda não pode ser menor que o custo' });
  });

  test('computes and persists the price from markup_percentual', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, custo: '20.00' });
    precosRepository.buscarCanalPorId.mockResolvedValue({ id: 1, nome: 'loja_fisica' });
    precosRepository.inserirPreco.mockResolvedValue({ id: 1, produto_id: 1, canal_id: 1, preco_venda: '30.00' });

    const result = await precosService.definirPreco(1, 1, { markup_percentual: 50 }, 7, 9);

    expect(precosRepository.inserirPreco).toHaveBeenCalledWith({
      produto_id: 1,
      canal_id: 1,
      preco_venda: 30,
      markup_percentual: 50,
      margem_percentual: 33.33,
      usuario_id: 7,
      empresa_id: 9
    });
    expect(result.preco_venda).toBe('30.00');
  });

  test('computes and persists the price from preco_venda, deriving markup/margem', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, custo: '20.00' });
    precosRepository.buscarCanalPorId.mockResolvedValue({ id: 1, nome: 'loja_fisica' });
    precosRepository.inserirPreco.mockResolvedValue({ id: 2 });

    await precosService.definirPreco(1, 1, { preco_venda: 30 }, 7);

    const chamada = precosRepository.inserirPreco.mock.calls[0][0];
    expect(chamada.preco_venda).toBe(30);
    expect(chamada.markup_percentual).toBe(50);
    expect(chamada.margem_percentual).toBeCloseTo(33.33, 2);
  });
});

describe('listarVigentesPorProduto', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(precosService.listarVigentesPorProduto(999)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('delegates to the repository when the produto exists', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
    precosRepository.listarPrecosVigentesPorProduto.mockResolvedValue([{ canal: 'loja_fisica', preco_venda: '30.00' }]);

    const result = await precosService.listarVigentesPorProduto(1);

    expect(result).toEqual([{ canal: 'loja_fisica', preco_venda: '30.00' }]);
  });
});

describe('historicoPorProduto', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(
      precosService.historicoPorProduto(999, undefined, { page: 1, pageSize: 20 })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('paginates across all canais when no canal filter is given', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
    precosRepository.listarHistoricoPorProduto.mockResolvedValue({ items: [{ id: 1 }], total: 1 });

    const result = await precosService.historicoPorProduto(1, undefined, { page: 1, pageSize: 20 }, 9);

    expect(precosRepository.listarHistoricoPorProduto).toHaveBeenCalledWith(1, undefined, 9, { limit: 20, offset: 0 });
    expect(result).toEqual({ items: [{ id: 1 }], page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  test('throws 400 for an invalid canal filter', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
    precosRepository.buscarCanalPorNome.mockResolvedValue(null);

    await expect(
      precosService.historicoPorProduto(1, 'inexistente', { page: 1, pageSize: 20 })
    ).rejects.toMatchObject({ statusCode: 400, message: 'Canal inválido' });
  });

  test('resolves a valid canal filter to its id before delegating', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
    precosRepository.buscarCanalPorNome.mockResolvedValue({ id: 2, nome: 'online' });
    precosRepository.listarHistoricoPorProduto.mockResolvedValue({ items: [], total: 0 });

    await precosService.historicoPorProduto(1, 'online', { page: 1, pageSize: 20 }, 9);

    expect(precosRepository.listarHistoricoPorProduto).toHaveBeenCalledWith(1, 2, 9, { limit: 20, offset: 0 });
  });
});

test('listarCanais delegates to the repository', async () => {
  precosRepository.listarCanais.mockResolvedValue([{ id: 1, nome: 'loja_fisica', ativo: true }]);

  await expect(precosService.listarCanais()).resolves.toEqual([{ id: 1, nome: 'loja_fisica', ativo: true }]);
});
