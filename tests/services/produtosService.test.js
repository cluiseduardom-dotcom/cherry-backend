jest.mock('../../src/repositories/produtosRepository');

const produtosRepository = require('../../src/repositories/produtosRepository');
const produtosService = require('../../src/services/produtosService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('paginates and attaches margem_percentual to each item', async () => {
    produtosRepository.listarPaginado.mockResolvedValue({
      items: [{ id: 1, preco_venda: '20.00', custo: '10.00' }],
      total: 1
    });

    const result = await produtosService.listar({ page: 1, pageSize: 20 });

    expect(produtosRepository.listarPaginado).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    expect(result).toEqual({
      items: [{ id: 1, preco_venda: '20.00', custo: '10.00', margem_percentual: 50 }],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1
    });
  });

  test('computes the correct offset for page > 1', async () => {
    produtosRepository.listarPaginado.mockResolvedValue({ items: [], total: 0 });

    await produtosService.listar({ page: 3, pageSize: 10 });

    expect(produtosRepository.listarPaginado).toHaveBeenCalledWith({ limit: 10, offset: 20 });
  });
});

describe('buscarPorId', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(produtosService.buscarPorId(999)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Produto não encontrado'
    });
  });

  test('returns the produto with margem_percentual', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, preco_venda: '10.00', custo: '5.00' });

    const result = await produtosService.buscarPorId(1);

    expect(result.margem_percentual).toBe(50);
  });
});

describe('criar', () => {
  test('throws 409 when the sku already exists', async () => {
    produtosRepository.buscarPorSku.mockResolvedValue({ id: 1 });

    await expect(
      produtosService.criar({ sku: 'X-1', nome: 'X', preco_venda: 10, custo: 5 })
    ).rejects.toMatchObject({ statusCode: 409, message: 'SKU já cadastrado' });

    expect(produtosRepository.criar).not.toHaveBeenCalled();
  });

  test('creates the produto when the sku is free', async () => {
    const dados = { sku: 'X-1', nome: 'X', preco_venda: 10, custo: 5 };
    produtosRepository.buscarPorSku.mockResolvedValue(null);
    produtosRepository.criar.mockResolvedValue({ id: 1, ...dados });

    const result = await produtosService.criar(dados);

    expect(produtosRepository.criar).toHaveBeenCalledWith(dados);
    expect(result.margem_percentual).toBe(50);
  });
});

describe('atualizar', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(produtosService.atualizar(999, { nome: 'Y' })).rejects.toMatchObject({
      statusCode: 404
    });
  });

  test('throws 409 when changing to a sku already taken by another produto', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: 'OLD' });
    produtosRepository.buscarPorSku.mockResolvedValue({ id: 2, sku: 'NEW' });

    await expect(produtosService.atualizar(1, { sku: 'NEW' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'SKU já cadastrado'
    });
  });

  test('updates the produto when the sku is unchanged or free', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: 'OLD' });
    produtosRepository.atualizar.mockResolvedValue({ id: 1, preco_venda: '20.00', custo: '10.00' });

    const result = await produtosService.atualizar(1, { preco_venda: 20 });

    expect(produtosRepository.buscarPorSku).not.toHaveBeenCalled();
    expect(result.margem_percentual).toBe(50);
  });
});

describe('remover', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(produtosService.remover(999)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('soft-deletes (desativar) the produto', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
    produtosRepository.desativar.mockResolvedValue({ id: 1, ativo: false, preco_venda: '10.00', custo: '5.00' });

    const result = await produtosService.remover(1);

    expect(produtosRepository.desativar).toHaveBeenCalledWith(1);
    expect(result.ativo).toBe(false);
  });
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
