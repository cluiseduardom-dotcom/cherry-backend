jest.mock('../../src/repositories/produtosRepository');
jest.mock('../../src/repositories/precosRepository');
jest.mock('../../src/repositories/categoriasRepository');
jest.mock('../../src/services/skuService');
jest.mock('../../src/config/db');

const produtosRepository = require('../../src/repositories/produtosRepository');
const precosRepository = require('../../src/repositories/precosRepository');
const categoriasRepository = require('../../src/repositories/categoriasRepository');
const skuService = require('../../src/services/skuService');
const db = require('../../src/config/db');
const produtosService = require('../../src/services/produtosService');

beforeEach(() => {
  jest.clearAllMocks();
  precosRepository.buscarCanalPorNome.mockResolvedValue({ id: 1, nome: 'loja_fisica' });
  precosRepository.listarPrecosVigentesPorCanal.mockResolvedValue([]);
  precosRepository.buscarPrecoVigente.mockResolvedValue(null);
  produtosRepository.buscarCategoriasDoProduto.mockResolvedValue([]);
  produtosRepository.buscarCategoriasPorProdutoIds.mockResolvedValue([]);
});

describe('listar', () => {
  test('paginates and attaches margem_percentual and preco_canal to each item', async () => {
    produtosRepository.listarPaginado.mockResolvedValue({
      items: [{ id: 1, preco_venda: '20.00', custo: '10.00' }],
      total: 1
    });

    const result = await produtosService.listar({ page: 1, pageSize: 20, canal: 'loja_fisica' });

    expect(produtosRepository.listarPaginado).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    expect(result).toEqual({
      items: [{
        id: 1, preco_venda: '20.00', custo: '10.00', margem_percentual: 50,
        preco_canal: { canal: 'loja_fisica', preco_venda: null, markup_percentual: null, margem_percentual: null, vigente_desde: null },
        categorias: []
      }],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1
    });
  });

  test('attaches the vigente price for the resolved canal when one exists', async () => {
    produtosRepository.listarPaginado.mockResolvedValue({
      items: [{ id: 1, preco_venda: '20.00', custo: '10.00' }],
      total: 1
    });
    precosRepository.listarPrecosVigentesPorCanal.mockResolvedValue([
      { produto_id: 1, preco_venda: '30.00', markup_percentual: '50.00', margem_percentual: '33.33', vigente_desde: '2026-01-01T00:00:00.000Z' }
    ]);

    const result = await produtosService.listar({ page: 1, pageSize: 20, canal: 'loja_fisica' });

    expect(result.items[0].preco_canal).toEqual({
      canal: 'loja_fisica', preco_venda: 30, markup_percentual: 50, margem_percentual: 33.33, vigente_desde: '2026-01-01T00:00:00.000Z'
    });
  });

  test('treats a matched-but-unpriced row as no price, not zero (LEFT JOIN LATERAL always returns one row per produto, with null columns when there is no price yet)', async () => {
    produtosRepository.listarPaginado.mockResolvedValue({
      items: [{ id: 1, preco_venda: '20.00', custo: '10.00' }],
      total: 1
    });
    precosRepository.listarPrecosVigentesPorCanal.mockResolvedValue([
      { produto_id: 1, preco_venda: null, markup_percentual: null, margem_percentual: null, vigente_desde: null }
    ]);

    const result = await produtosService.listar({ page: 1, pageSize: 20, canal: 'loja_fisica' });

    expect(result.items[0].preco_canal).toEqual({
      canal: 'loja_fisica', preco_venda: null, markup_percentual: null, margem_percentual: null, vigente_desde: null
    });
  });

  test('computes the correct offset for page > 1', async () => {
    produtosRepository.listarPaginado.mockResolvedValue({ items: [], total: 0 });

    await produtosService.listar({ page: 3, pageSize: 10, canal: 'loja_fisica' });

    expect(produtosRepository.listarPaginado).toHaveBeenCalledWith({ limit: 10, offset: 20 });
  });

  test('throws 400 when the canal does not exist', async () => {
    precosRepository.buscarCanalPorNome.mockResolvedValue(null);
    produtosRepository.listarPaginado.mockResolvedValue({ items: [], total: 0 });

    await expect(
      produtosService.listar({ page: 1, pageSize: 20, canal: 'inexistente' })
    ).rejects.toMatchObject({ statusCode: 400, message: 'Canal inválido' });
  });
});

describe('buscarPorId', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(produtosService.buscarPorId(999, 'loja_fisica')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Produto não encontrado'
    });
  });

  test('returns the produto with margem_percentual and preco_canal', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, preco_venda: '10.00', custo: '5.00' });

    const result = await produtosService.buscarPorId(1, 'loja_fisica');

    expect(result.margem_percentual).toBe(50);
    expect(result.preco_canal).toEqual({
      canal: 'loja_fisica', preco_venda: null, markup_percentual: null, margem_percentual: null, vigente_desde: null
    });
  });

  test('throws 400 when the canal does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, preco_venda: '10.00', custo: '5.00' });
    precosRepository.buscarCanalPorNome.mockResolvedValue(null);

    await expect(produtosService.buscarPorId(1, 'inexistente')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Canal inválido'
    });
  });
});

describe('listar (categorias)', () => {
  test('attaches the categorias linked to each produto', async () => {
    produtosRepository.listarPaginado.mockResolvedValue({
      items: [{ id: 1, preco_venda: '20.00', custo: '10.00' }, { id: 2, preco_venda: '30.00', custo: '15.00' }],
      total: 2
    });
    produtosRepository.buscarCategoriasPorProdutoIds.mockResolvedValue([
      { produto_id: 1, id: 10, nivel: 1, codigo: 'BR', nome: 'Brinco' }
    ]);

    const result = await produtosService.listar({ page: 1, pageSize: 20, canal: 'loja_fisica' });

    expect(result.items[0].categorias).toEqual([{ id: 10, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);
    expect(result.items[1].categorias).toEqual([]);
  });
});

describe('buscarPorId (categorias)', () => {
  test('attaches the categorias linked to the produto', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, preco_venda: '10.00', custo: '5.00' });
    produtosRepository.buscarCategoriasDoProduto.mockResolvedValue([{ id: 10, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);

    const result = await produtosService.buscarPorId(1, 'loja_fisica');

    expect(result.categorias).toEqual([{ id: 10, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);
  });
});

describe('categorizar', () => {
  let client;

  beforeEach(() => {
    client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    db.connect.mockResolvedValue(client);
  });

  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(produtosService.categorizar(999, [1], 9)).rejects.toMatchObject({ statusCode: 404 });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test('throws 400 when a categoria_id does not resolve to an active categoria in this empresa', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: null });
    categoriasRepository.buscarPorIds.mockResolvedValue([{ id: 1, nivel: 1, codigo: 'BR' }]);

    await expect(produtosService.categorizar(1, [1, 2], 9)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test('throws 400 when two categorias share the same nivel', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: null });
    categoriasRepository.buscarPorIds.mockResolvedValue([
      { id: 1, nivel: 1, codigo: 'BR' },
      { id: 2, nivel: 1, codigo: 'CO' }
    ]);

    await expect(produtosService.categorizar(1, [1, 2], 9)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Não é permitido mais de uma categoria do mesmo nível'
    });
  });

  test('generates the sku on first categorization (produto has no sku yet)', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: null, preco_venda: '10.00', custo: '5.00' });
    categoriasRepository.buscarPorIds.mockResolvedValue([{ id: 1, nivel: 1, codigo: 'BR' }]);
    skuService.gerar.mockResolvedValue('BR001');
    produtosRepository.definirSkuSeNulo.mockResolvedValue({ id: 1, sku: 'BR001', preco_venda: '10.00', custo: '5.00' });
    produtosRepository.buscarCategoriasDoProduto.mockResolvedValue([{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);

    const result = await produtosService.categorizar(1, [1], 9);

    expect(produtosRepository.substituirCategorias).toHaveBeenCalledWith(1, [1], 9, client);
    expect(skuService.gerar).toHaveBeenCalledWith([{ id: 1, nivel: 1, codigo: 'BR' }], 9, client);
    expect(produtosRepository.definirSkuSeNulo).toHaveBeenCalledWith(1, 'BR001', 9, client);
    expect(result.sku).toBe('BR001');
    expect(result.categorias).toEqual([{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('never regenerates the sku when the produto already has one, even with new categorias', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: 'BR001', preco_venda: '10.00', custo: '5.00' });
    categoriasRepository.buscarPorIds.mockResolvedValue([{ id: 2, nivel: 1, codigo: 'CO' }]);

    const result = await produtosService.categorizar(1, [2], 9);

    expect(produtosRepository.substituirCategorias).toHaveBeenCalledWith(1, [2], 9, client);
    expect(skuService.gerar).not.toHaveBeenCalled();
    expect(produtosRepository.definirSkuSeNulo).not.toHaveBeenCalled();
    expect(result.sku).toBe('BR001');
  });

  test('does not generate a sku when categoriaIds is empty (clears the link, no-op on sku)', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: null, preco_venda: '10.00', custo: '5.00' });

    const result = await produtosService.categorizar(1, [], 9);

    expect(categoriasRepository.buscarPorIds).not.toHaveBeenCalled();
    expect(produtosRepository.substituirCategorias).toHaveBeenCalledWith(1, [], 9, client);
    expect(skuService.gerar).not.toHaveBeenCalled();
    expect(result.sku).toBeNull();
  });

  test('rolls back and converts a unique-violation on the sku write into a clean 409', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: null, preco_venda: '10.00', custo: '5.00' });
    categoriasRepository.buscarPorIds.mockResolvedValue([{ id: 1, nivel: 1, codigo: 'BR' }]);
    skuService.gerar.mockResolvedValue('BR001');
    const erroColisao = new Error('duplicate key value violates unique constraint "idx_produtos_sku_unico"');
    erroColisao.code = '23505';
    produtosRepository.definirSkuSeNulo.mockRejectedValue(erroColisao);

    await expect(produtosService.categorizar(1, [1], 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Erro ao gerar SKU, tente novamente'
    });

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('criar', () => {
  test('creates the produto and attaches margem_percentual', async () => {
    const dados = { nome: 'X', preco_venda: 10, custo: 5 };
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

  test('updates the produto', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
    produtosRepository.atualizar.mockResolvedValue({ id: 1, preco_venda: '20.00', custo: '10.00' });

    const result = await produtosService.atualizar(1, { preco_venda: 20 });

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

    const result = await produtosService.remover(1, 7);

    expect(produtosRepository.desativar).toHaveBeenCalledWith(1, 7);
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

    const result = await produtosService.ajustarPreco(1, 0.1, 7);

    expect(produtosRepository.ajustarPreco).toHaveBeenCalledWith(1, 0.1, 7);
    expect(result).toEqual({ id: 1, preco_venda: 11 });
  });
});

test('dashboard delegates to the repository', async () => {
  produtosRepository.getDashboard.mockResolvedValue({ total_vendas: 3 });

  await expect(produtosService.dashboard()).resolves.toEqual({ total_vendas: 3 });
});
