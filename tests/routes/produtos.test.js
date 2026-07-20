jest.mock('../../src/services/produtosService');

const request = require('supertest');
const produtosService = require('../../src/services/produtosService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const vendedorToken = makeToken({ id: 1, role: 'vendedor' });
const adminToken = makeToken({ id: 2, role: 'admin' });

beforeEach(() => {
  jest.clearAllMocks();
});

test('GET /produtos returns 401 without a token', async () => {
  const res = await request(app).get('/produtos');
  expect(res.status).toBe(401);
});

describe('GET /produtos (list + pagination)', () => {
  const paginatedResult = {
    items: [{ id: 1, sku: 'CAM-001', nome: 'Camiseta', preco_venda: '49.90', custo: '20.00', margem_percentual: 59.92 }],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1
  };

  test('strips custo and margem_percentual for a vendedor', async () => {
    produtosService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/produtos').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toEqual({ id: 1, sku: 'CAM-001', nome: 'Camiseta', preco_venda: '49.90' });
    expect(res.body.data.items[0]).not.toHaveProperty('custo');
    expect(res.body.data.items[0]).not.toHaveProperty('margem_percentual');
  });

  test('includes custo and margem_percentual for an admin', async () => {
    produtosService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/produtos').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toEqual(paginatedResult.items[0]);
  });

  test('parses page/pageSize query params', async () => {
    produtosService.listar.mockResolvedValue(paginatedResult);

    await request(app)
      .get('/produtos?page=2&pageSize=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(produtosService.listar).toHaveBeenCalledWith({ page: 2, pageSize: 5 });
  });

  test('falls back to defaults for invalid pagination params', async () => {
    produtosService.listar.mockResolvedValue(paginatedResult);

    await request(app)
      .get('/produtos?page=abc&pageSize=-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(produtosService.listar).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });
});

describe('GET /produtos/:id', () => {
  const produto = { id: 1, sku: 'CAM-001', nome: 'Camiseta', preco_venda: '49.90', custo: '20.00', margem_percentual: 59.92 };

  test('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/produtos/abc').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID inválido');
  });

  test('returns 404 when the service throws', async () => {
    produtosService.buscarPorId.mockRejectedValue(new AppError('Produto não encontrado', 404));

    const res = await request(app).get('/produtos/999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('strips custo/margem_percentual for a vendedor', async () => {
    produtosService.buscarPorId.mockResolvedValue(produto);

    const res = await request(app).get('/produtos/1').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('custo');
    expect(res.body.data).not.toHaveProperty('margem_percentual');
  });

  test('returns full data for an admin', async () => {
    produtosService.buscarPorId.mockResolvedValue(produto);

    const res = await request(app).get('/produtos/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data).toEqual(produto);
  });
});

describe('POST /produtos (admin only)', () => {
  const validBody = { sku: 'CAM-001', nome: 'Camiseta', preco_venda: 49.9, custo: 20 };

  test('returns 403 for a non-admin (vendedor) token', async () => {
    const res = await request(app)
      .post('/produtos')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send(validBody);

    expect(res.status).toBe(403);
    expect(produtosService.criar).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid body even with an admin token', async () => {
    const res = await request(app)
      .post('/produtos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('SKU é obrigatório');
  });

  test('returns 201 and the created produto for an admin', async () => {
    produtosService.criar.mockResolvedValue({ id: 1, ...validBody, margem_percentual: 59.92 });

    const res = await request(app)
      .post('/produtos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
  });
});

describe('PUT /produtos/:id (admin only)', () => {
  test('returns 403 for a non-admin (estoquista) token', async () => {
    const estoquistaToken = makeToken({ id: 3, role: 'estoquista' });

    const res = await request(app)
      .put('/produtos/1')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ preco_venda: 60 });

    expect(res.status).toBe(403);
    expect(produtosService.atualizar).not.toHaveBeenCalled();
  });

  test('returns 400 for an empty body', async () => {
    const res = await request(app)
      .put('/produtos/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Informe ao menos um campo para atualizar');
  });

  test('returns 200 with the updated produto for an admin', async () => {
    produtosService.atualizar.mockResolvedValue({ id: 1, preco_venda: '60.00', custo: '20.00', margem_percentual: 66.67 });

    const res = await request(app)
      .put('/produtos/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ preco_venda: 60 });

    expect(res.status).toBe(200);
    expect(produtosService.atualizar).toHaveBeenCalledWith(1, { preco_venda: 60 });
  });
});

describe('DELETE /produtos/:id (admin only, soft delete)', () => {
  test('returns 403 for a non-admin (vendedor) token', async () => {
    const res = await request(app).delete('/produtos/1').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(403);
    expect(produtosService.remover).not.toHaveBeenCalled();
  });

  test('returns 404 when the produto does not exist', async () => {
    produtosService.remover.mockRejectedValue(new AppError('Produto não encontrado', 404));

    const res = await request(app).delete('/produtos/999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('deactivates the produto for an admin', async () => {
    produtosService.remover.mockResolvedValue({ id: 1, ativo: false, preco_venda: '49.90', custo: '20.00', margem_percentual: 59.92 });

    const res = await request(app).delete('/produtos/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ativo).toBe(false);
  });
});

describe('read-only sub-routes', () => {
  const cases = [
    ['/produtos/mais-vendidos', 'maisVendidos'],
    ['/produtos/curva-abc', 'curvaABC'],
    ['/produtos/reposicao', 'reposicao'],
    ['/produtos/sugestao-preco', 'sugestaoPreco'],
    ['/produtos/giro', 'giro'],
    ['/produtos/parados', 'parados'],
    ['/produtos/pricing', 'pricingProfissional'],
    ['/produtos/pricing-profissional', 'pricingProfissional'],
    ['/produtos/lucro', 'lucroPorProduto'],
    ['/produtos/alerta-prejuizo', 'alertaPrejuizo'],
    ['/produtos/inteligencia', 'inteligencia'],
    ['/produtos/dashboard', 'dashboard']
  ];

  test.each(cases)('GET %s calls service.%s and wraps the result', async (path, serviceMethod) => {
    produtosService[serviceMethod].mockResolvedValue({ ok: true });

    const res = await request(app).get(path).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: true } });
    expect(produtosService[serviceMethod]).toHaveBeenCalled();
  });
});
