jest.mock('../../src/services/produtosService');

const request = require('supertest');
const produtosService = require('../../src/services/produtosService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const vendedorToken = makeToken({ id: 1, role: 'vendedor', empresa_id: 1 });
const adminToken = makeToken({ id: 2, role: 'admin', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

test('GET /produtos returns 401 without a token', async () => {
  const res = await request(app).get('/produtos');
  expect(res.status).toBe(401);
});

describe('GET /produtos (list + pagination)', () => {
  const paginatedResult = {
    items: [{
      id: 1, sku: 'CAM-001', nome: 'Camiseta', preco_venda: '49.90', custo: '20.00', margem_percentual: 59.92,
      preco_canal: { canal: 'loja_fisica', preco_venda: 55.5, markup_percentual: 50, margem_percentual: 33.33, vigente_desde: '2026-01-01T00:00:00.000Z' }
    }],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1
  };

  test('strips custo, margem_percentual, and preco_canal markup/margem for a vendedor', async () => {
    produtosService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/produtos').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toEqual({
      id: 1, sku: 'CAM-001', nome: 'Camiseta', preco_venda: '49.90',
      preco_canal: { canal: 'loja_fisica', preco_venda: 55.5 }
    });
    expect(res.body.data.items[0]).not.toHaveProperty('custo');
    expect(res.body.data.items[0]).not.toHaveProperty('margem_percentual');
    expect(res.body.data.items[0].preco_canal).not.toHaveProperty('markup_percentual');
    expect(res.body.data.items[0].preco_canal).not.toHaveProperty('margem_percentual');
  });

  test('includes custo, margem_percentual, and full preco_canal for an admin', async () => {
    produtosService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/produtos').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toEqual(paginatedResult.items[0]);
  });

  test('parses page/pageSize query params and defaults canal to loja_fisica', async () => {
    produtosService.listar.mockResolvedValue(paginatedResult);

    await request(app)
      .get('/produtos?page=2&pageSize=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(produtosService.listar).toHaveBeenCalledWith({ page: 2, pageSize: 5, canal: 'loja_fisica' }, 1);
  });

  test('falls back to defaults for invalid pagination params', async () => {
    produtosService.listar.mockResolvedValue(paginatedResult);

    await request(app)
      .get('/produtos?page=abc&pageSize=-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(produtosService.listar).toHaveBeenCalledWith({ page: 1, pageSize: 20, canal: 'loja_fisica' }, 1);
  });

  test('passes an explicit canal query param through', async () => {
    produtosService.listar.mockResolvedValue(paginatedResult);

    await request(app)
      .get('/produtos?canal=online')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(produtosService.listar).toHaveBeenCalledWith({ page: 1, pageSize: 20, canal: 'online' }, 1);
  });

  test('returns 400 when the service rejects an invalid canal', async () => {
    produtosService.listar.mockRejectedValue(new AppError('Canal inválido', 400));

    const res = await request(app)
      .get('/produtos?canal=inexistente')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });
});

describe('GET /produtos/:id', () => {
  const produto = {
    id: 1, sku: 'CAM-001', nome: 'Camiseta', preco_venda: '49.90', custo: '20.00', margem_percentual: 59.92,
    preco_canal: { canal: 'loja_fisica', preco_venda: 55.5, markup_percentual: 50, margem_percentual: 33.33, vigente_desde: '2026-01-01T00:00:00.000Z' }
  };

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

  test('strips custo/margem_percentual and preco_canal markup/margem for a vendedor', async () => {
    produtosService.buscarPorId.mockResolvedValue(produto);

    const res = await request(app).get('/produtos/1').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('custo');
    expect(res.body.data).not.toHaveProperty('margem_percentual');
    expect(res.body.data.preco_canal).toEqual({ canal: 'loja_fisica', preco_venda: 55.5 });
  });

  test('returns full data for an admin', async () => {
    produtosService.buscarPorId.mockResolvedValue(produto);

    const res = await request(app).get('/produtos/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data).toEqual(produto);
  });

  test('defaults canal to loja_fisica and passes an explicit canal through', async () => {
    produtosService.buscarPorId.mockResolvedValue(produto);

    await request(app).get('/produtos/1').set('Authorization', `Bearer ${adminToken}`);
    expect(produtosService.buscarPorId).toHaveBeenCalledWith(1, 'loja_fisica', 1);

    await request(app).get('/produtos/1?canal=online').set('Authorization', `Bearer ${adminToken}`);
    expect(produtosService.buscarPorId).toHaveBeenCalledWith(1, 'online', 1);
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
    const estoquistaToken = makeToken({ id: 3, role: 'estoquista', empresa_id: 1 });

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
    expect(produtosService.atualizar).toHaveBeenCalledWith(1, { preco_venda: 60 }, 1);
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

describe('rotas analíticas de /produtos filtram custo/margem/lucro por papel (leitura liberada, sem bloqueio total)', () => {
  const casos = [
    {
      path: '/produtos/giro', metodo: 'giro',
      dados: [{ id: 1, nome: 'Camiseta', total_vendido: 5, dias_com_venda: 3 }],
      sensiveis: []
    },
    {
      path: '/produtos/parados', metodo: 'parados',
      dados: [{ id: 1, nome: 'Camiseta', ultima_venda: null }],
      sensiveis: []
    },
    {
      path: '/produtos/mais-vendidos', metodo: 'maisVendidos',
      dados: [{ id: 1, nome: 'Camiseta', total_vendido: 5, faturamento: 250 }],
      sensiveis: []
    },
    {
      path: '/produtos/curva-abc', metodo: 'curvaABC',
      dados: [{ id: 1, nome: 'Camiseta', faturamento: 1200, curva: 'A' }],
      sensiveis: []
    },
    {
      path: '/produtos/reposicao', metodo: 'reposicao',
      dados: [{ id: 1, nome: 'Camiseta', vendido: 2, status: 'REPOR URGENTE' }],
      sensiveis: []
    },
    {
      path: '/produtos/dashboard', metodo: 'dashboard',
      dados: { total_vendas: 10, faturamento: 500, ticket_medio: 50 },
      sensiveis: []
    },
    {
      path: '/produtos/pricing', metodo: 'pricingProfissional',
      dados: [{ id: 1, nome: 'Camiseta', custo: 20, preco_venda: 49.9, total_vendido: 5, preco_sugerido: 44 }],
      sensiveis: ['custo']
    },
    {
      path: '/produtos/pricing-profissional', metodo: 'pricingProfissional',
      dados: [{ id: 1, nome: 'Camiseta', custo: 20, preco_venda: 49.9, total_vendido: 5, preco_sugerido: 44 }],
      sensiveis: ['custo']
    },
    {
      path: '/produtos/lucro', metodo: 'lucroPorProduto',
      dados: [{ id: 1, nome: 'Camiseta', total_vendido: 5, faturamento: 250, custo_total: 100, lucro: 150, margem_percentual: 60 }],
      sensiveis: ['custo_total', 'lucro', 'margem_percentual']
    },
    {
      path: '/produtos/alerta-prejuizo', metodo: 'alertaPrejuizo',
      dados: [{ id: 1, nome: 'Camiseta', custo: 20, preco_venda: 15, lucro_unitario: -5 }],
      sensiveis: ['custo', 'lucro_unitario']
    },
    {
      path: '/produtos/sugestao-preco', metodo: 'sugestaoPreco',
      dados: [{ id: 1, nome: 'Camiseta', custo: 20, preco_venda: 49.9, preco_sugerido: 64 }],
      sensiveis: ['custo']
    },
    {
      path: '/produtos/inteligencia', metodo: 'inteligencia',
      dados: [{ id: 1, nome: 'Camiseta', total_vendido: 5, lucro_unitario: 29.9, decisao: 'MANTER' }],
      sensiveis: ['lucro_unitario']
    }
  ];

  const primeiraLinha = (data) => (Array.isArray(data) ? data[0] : data);

  test.each(casos)('GET $path — admin recebe o dado completo, sem filtro', async ({ path, metodo, dados }) => {
    produtosService[metodo].mockResolvedValue(dados);

    const res = await request(app).get(path).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(dados);
  });

  test.each(casos)('GET $path — vendedor recebe 200 sem custo/margem/lucro', async ({ path, metodo, dados, sensiveis }) => {
    produtosService[metodo].mockResolvedValue(dados);

    const res = await request(app).get(path).set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    const linha = primeiraLinha(res.body.data);
    for (const campo of sensiveis) {
      expect(linha).not.toHaveProperty(campo);
    }
    expect(produtosService[metodo]).toHaveBeenCalled();
  });

  test.each(casos)('GET $path — estoquista recebe 200 sem custo/margem/lucro', async ({ path, metodo, dados, sensiveis }) => {
    const estoquistaToken = makeToken({ id: 3, role: 'estoquista', empresa_id: 1 });
    produtosService[metodo].mockResolvedValue(dados);

    const res = await request(app).get(path).set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
    const linha = primeiraLinha(res.body.data);
    for (const campo of sensiveis) {
      expect(linha).not.toHaveProperty(campo);
    }
    expect(produtosService[metodo]).toHaveBeenCalled();
  });
});
