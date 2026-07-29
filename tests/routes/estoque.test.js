jest.mock('../../src/services/estoqueService');

const request = require('supertest');
const estoqueService = require('../../src/services/estoqueService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /produtos/:id/movimentacoes', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).post('/produtos/1/movimentacoes').send({ tipo: 'entrada', quantidade: 5 });
    expect(res.status).toBe(401);
  });

  test('returns 403 for a vendedor', async () => {
    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ tipo: 'entrada', quantidade: 5 });

    expect(res.status).toBe(403);
    expect(estoqueService.registrarMovimentacao).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ tipo: 'invalido', quantidade: 5 });

    expect(res.status).toBe(400);
  });

  test('returns 400 for a non-numeric produto id', async () => {
    const res = await request(app)
      .post('/produtos/abc/movimentacoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tipo: 'entrada', quantidade: 5 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID inválido');
  });

  test('returns 201 for an estoquista with a valid body', async () => {
    estoqueService.registrarMovimentacao.mockResolvedValue({
      id: 1,
      produto_id: 1,
      tipo: 'entrada',
      quantidade: 10,
      estoque_resultante: 10
    });

    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ tipo: 'entrada', quantidade: 10, motivo: 'Reposição' });

    expect(res.status).toBe(201);
    expect(res.body.data.estoque_resultante).toBe(10);
    expect(estoqueService.registrarMovimentacao).toHaveBeenCalledWith(
      1,
      { tipo: 'entrada', quantidade: 10, motivo: 'Reposição' },
      2,
      1
    );
  });

  test('returns 201 for an admin too', async () => {
    estoqueService.registrarMovimentacao.mockResolvedValue({ id: 1 });

    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tipo: 'ajuste', quantidade: 0 });

    expect(res.status).toBe(201);
  });

  test('maps a 409 (insufficient stock) from the service', async () => {
    estoqueService.registrarMovimentacao.mockRejectedValue(
      new AppError('Estoque insuficiente para essa saída', 409)
    );

    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ tipo: 'saida', quantidade: 999 });

    expect(res.status).toBe(409);
  });
});

describe('GET /produtos/:id/movimentacoes', () => {
  test('is available to any authenticated role (vendedor)', async () => {
    estoqueService.historicoPorProduto.mockResolvedValue({
      items: [], page: 1, pageSize: 20, total: 0, totalPages: 1
    });

    const res = await request(app)
      .get('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(estoqueService.historicoPorProduto).toHaveBeenCalledWith(1, { page: 1, pageSize: 20 }, 1);
  });

  test('returns 404 when the service throws', async () => {
    estoqueService.historicoPorProduto.mockRejectedValue(new AppError('Produto não encontrado', 404));

    const res = await request(app)
      .get('/produtos/999/movimentacoes')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /produtos/estoque-baixo', () => {
  test('is available to any authenticated role (vendedor) and never includes pricing', async () => {
    estoqueService.alertasEstoqueBaixo.mockResolvedValue([
      { id: 1, sku: 'X-1', nome: 'X', categoria: null, estoque_atual: 1, estoque_minimo: 5 }
    ]);

    const res = await request(app).get('/produtos/estoque-baixo').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('custo');
    expect(res.body.data[0]).not.toHaveProperty('preco_venda');
    expect(res.body.data[0]).not.toHaveProperty('margem_percentual');
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).get('/produtos/estoque-baixo');
    expect(res.status).toBe(401);
  });
});
