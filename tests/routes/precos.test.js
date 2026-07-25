jest.mock('../../src/services/precosService');

const request = require('supertest');
const precosService = require('../../src/services/precosService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin' });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista' });
const vendedorToken = makeToken({ id: 3, role: 'vendedor' });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PUT /produtos/:id/precos/:canalId (admin only)', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).put('/produtos/1/precos/1').send({ markup_percentual: 50 });
    expect(res.status).toBe(401);
  });

  test('returns 403 for a vendedor', async () => {
    const res = await request(app)
      .put('/produtos/1/precos/1')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ markup_percentual: 50 });

    expect(res.status).toBe(403);
    expect(precosService.definirPreco).not.toHaveBeenCalled();
  });

  test('returns 403 for an estoquista', async () => {
    const res = await request(app)
      .put('/produtos/1/precos/1')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ markup_percentual: 50 });

    expect(res.status).toBe(403);
    expect(precosService.definirPreco).not.toHaveBeenCalled();
  });

  test('returns 400 for a body with neither markup_percentual nor preco_venda', async () => {
    const res = await request(app)
      .put('/produtos/1/precos/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('returns 400 for a body with both markup_percentual and preco_venda', async () => {
    const res = await request(app)
      .put('/produtos/1/precos/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ markup_percentual: 50, preco_venda: 30 });

    expect(res.status).toBe(400);
  });

  test('returns 400 for a body carrying a client-supplied margem_percentual', async () => {
    const res = await request(app)
      .put('/produtos/1/precos/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ markup_percentual: 50, margem_percentual: 33 });

    expect(res.status).toBe(400);
    expect(precosService.definirPreco).not.toHaveBeenCalled();
  });

  test('returns 400 for a non-numeric produto id', async () => {
    const res = await request(app)
      .put('/produtos/abc/precos/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ markup_percentual: 50 });

    expect(res.status).toBe(400);
  });

  test('returns 201 for an admin with a valid markup_percentual body', async () => {
    precosService.definirPreco.mockResolvedValue({
      id: 1, produto_id: 1, canal_id: 1, preco_venda: '30.00', markup_percentual: '50.00', margem_percentual: '33.33'
    });

    const res = await request(app)
      .put('/produtos/1/precos/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ markup_percentual: 50 });

    expect(res.status).toBe(201);
    expect(precosService.definirPreco).toHaveBeenCalledWith(1, 1, { markup_percentual: 50 }, 1);
    expect(res.body.data.preco_venda).toBe('30.00');
  });

  test('maps a 409 (preco below custo) from the service', async () => {
    precosService.definirPreco.mockRejectedValue(new AppError('Preço de venda não pode ser menor que o custo', 409));

    const res = await request(app)
      .put('/produtos/1/precos/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ preco_venda: 1 });

    expect(res.status).toBe(409);
  });

  test('maps a 404 when the canal does not exist', async () => {
    precosService.definirPreco.mockRejectedValue(new AppError('Canal não encontrado', 404));

    const res = await request(app)
      .put('/produtos/1/precos/999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ preco_venda: 30 });

    expect(res.status).toBe(404);
  });
});

describe('GET /produtos/:id/precos (all roles, vendedor never sees custo/markup/margem)', () => {
  const precosVigentes = [
    { canal: 'loja_fisica', preco_venda: '30.00', markup_percentual: '50.00', margem_percentual: '33.33', vigente_desde: '2026-01-01T00:00:00.000Z' },
    { canal: 'online', preco_venda: null, markup_percentual: null, margem_percentual: null, vigente_desde: null }
  ];

  test('returns 401 without a token', async () => {
    const res = await request(app).get('/produtos/1/precos');
    expect(res.status).toBe(401);
  });

  test('returns markup/margem for an admin', async () => {
    precosService.listarVigentesPorProduto.mockResolvedValue(precosVigentes);

    const res = await request(app).get('/produtos/1/precos').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual(precosVigentes[0]);
  });

  test('returns markup/margem for an estoquista', async () => {
    precosService.listarVigentesPorProduto.mockResolvedValue(precosVigentes);

    const res = await request(app).get('/produtos/1/precos').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toHaveProperty('markup_percentual');
    expect(res.body.data[0]).toHaveProperty('margem_percentual');
  });

  test('strips markup_percentual and margem_percentual for a vendedor', async () => {
    precosService.listarVigentesPorProduto.mockResolvedValue(precosVigentes);

    const res = await request(app).get('/produtos/1/precos').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual({ canal: 'loja_fisica', preco_venda: '30.00' });
    expect(res.body.data[0]).not.toHaveProperty('markup_percentual');
    expect(res.body.data[0]).not.toHaveProperty('margem_percentual');
  });

  test('returns 404 when the produto does not exist', async () => {
    precosService.listarVigentesPorProduto.mockRejectedValue(new AppError('Produto não encontrado', 404));

    const res = await request(app).get('/produtos/999/precos').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /produtos/:id/precos/historico (admin only)', () => {
  test('returns 403 for a vendedor', async () => {
    const res = await request(app)
      .get('/produtos/1/precos/historico')
      .set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(403);
    expect(precosService.historicoPorProduto).not.toHaveBeenCalled();
  });

  test('returns 403 for an estoquista', async () => {
    const res = await request(app)
      .get('/produtos/1/precos/historico')
      .set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(403);
  });

  test('paginates for an admin', async () => {
    precosService.historicoPorProduto.mockResolvedValue({
      items: [{ id: 1 }], page: 1, pageSize: 20, total: 1, totalPages: 1
    });

    const res = await request(app)
      .get('/produtos/1/precos/historico?page=2&pageSize=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(precosService.historicoPorProduto).toHaveBeenCalledWith(1, undefined, { page: 2, pageSize: 5 });
  });

  test('passes the canal query param through', async () => {
    precosService.historicoPorProduto.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });

    await request(app)
      .get('/produtos/1/precos/historico?canal=online')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(precosService.historicoPorProduto).toHaveBeenCalledWith(1, 'online', { page: 1, pageSize: 20 });
  });
});
