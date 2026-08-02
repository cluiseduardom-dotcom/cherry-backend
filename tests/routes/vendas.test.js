jest.mock('../../src/services/vendasService');

const request = require('supertest');
const vendasService = require('../../src/services/vendasService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const vendedorToken = makeToken({ id: 2, role: 'vendedor', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 3, role: 'estoquista', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

test('GET /vendas/resumo returns 401 without a token', async () => {
  const res = await request(app).get('/vendas/resumo');
  expect(res.status).toBe(401);
});

test('GET /vendas/resumo returns the wrapped summary for an admin', async () => {
  vendasService.resumo.mockResolvedValue({ total_vendas: 3, faturamento: 100 });

  const res = await request(app).get('/vendas/resumo').set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: { total_vendas: 3, faturamento: 100 } });
});

describe('analytical sub-routes (admin only)', () => {
  const cases = [
    ['/vendas/resumo', 'resumo'],
    ['/vendas/por-dia', 'porDia'],
    ['/vendas/por-mes', 'porMes'],
    ['/vendas/mais-vendidos', 'maisVendidos']
  ];

  test.each(cases)('GET %s returns 200 for an admin', async (path, serviceMethod) => {
    vendasService[serviceMethod].mockResolvedValue({ ok: true });

    const res = await request(app).get(path).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(vendasService[serviceMethod]).toHaveBeenCalled();
  });

  test.each(cases)('GET %s returns 403 for a vendedor', async (path, serviceMethod) => {
    const res = await request(app).get(path).set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(403);
    expect(vendasService[serviceMethod]).not.toHaveBeenCalled();
  });

  test.each(cases)('GET %s returns 403 for an estoquista', async (path, serviceMethod) => {
    const res = await request(app).get(path).set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(403);
    expect(vendasService[serviceMethod]).not.toHaveBeenCalled();
  });
});

describe('POST /vendas (admin and vendedor only)', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).post('/vendas').send({ itens: [{ produto_id: 1, quantidade: 1 }] });
    expect(res.status).toBe(401);
  });

  test('returns 403 for an estoquista', async () => {
    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ itens: [{ produto_id: 1, quantidade: 1 }] });

    expect(res.status).toBe(403);
    expect(vendasService.criar).not.toHaveBeenCalled();
  });

  test('returns 400 when itens is empty', async () => {
    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ cliente_id: 1, itens: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A venda deve ter ao menos um item');
    expect(vendasService.criar).not.toHaveBeenCalled();
  });

  test('returns 400 when the client supplies a preco_unitario', async () => {
    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 999 }] });

    expect(res.status).toBe(400);
    expect(vendasService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 for a vendedor and passes body + usuario_id to the service', async () => {
    vendasService.criar.mockResolvedValue({ id: 1, total: '30.00', itens: [{ produto_id: 1, quantidade: 3, preco_unitario: '10.00' }] });

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ itens: [{ produto_id: 1, quantidade: 3 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe('30.00');
    expect(vendasService.criar).toHaveBeenCalledWith({ itens: [{ produto_id: 1, quantidade: 3 }] }, 2, 1);
  });

  test('returns 201 for an admin too', async () => {
    vendasService.criar.mockResolvedValue({ id: 1 });

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itens: [{ produto_id: 1, quantidade: 1 }] });

    expect(res.status).toBe(201);
  });

  test('maps a 409 (insufficient stock) from the service, atomically — nothing is created', async () => {
    vendasService.criar.mockRejectedValue(new AppError('Estoque insuficiente para essa venda', 409));

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ itens: [{ produto_id: 1, quantidade: 9999 }] });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  test('maps a 400 (inactive produto) from the service', async () => {
    vendasService.criar.mockRejectedValue(new AppError('Produto inativo não pode ser vendido', 400));

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ itens: [{ produto_id: 1, quantidade: 1 }] });

    expect(res.status).toBe(400);
  });

  test('returns 400 for forma_pagamento prazo without dias_prazo', async () => {
    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ forma_pagamento: 'prazo', itens: [{ produto_id: 1, quantidade: 1 }] });

    expect(res.status).toBe(400);
    expect(vendasService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 for a prazo venda and forwards forma_pagamento/dias_prazo to the service', async () => {
    vendasService.criar.mockResolvedValue({ id: 1, total: '10.00', conta_receber: { id: 1, status: 'pendente' } });

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ forma_pagamento: 'prazo', dias_prazo: 30, itens: [{ produto_id: 1, quantidade: 1 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.conta_receber.status).toBe('pendente');
    expect(vendasService.criar).toHaveBeenCalledWith(
      { forma_pagamento: 'prazo', dias_prazo: 30, itens: [{ produto_id: 1, quantidade: 1 }] },
      2,
      1
    );
  });

  test('maps a 409 (no price defined for the canal) from the service', async () => {
    vendasService.criar.mockRejectedValue(new AppError('Produto sem preço definido para o canal informado', 409));

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ itens: [{ produto_id: 1, quantidade: 1 }] });

    expect(res.status).toBe(409);
  });
});

describe('GET /vendas (admin and vendedor only, paginated)', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).get('/vendas');
    expect(res.status).toBe(401);
  });

  test('returns 403 for an estoquista', async () => {
    const res = await request(app).get('/vendas').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
    expect(vendasService.listar).not.toHaveBeenCalled();
  });

  test('passes page/pageSize and the authenticated usuario through to the service', async () => {
    vendasService.listar.mockResolvedValue({ items: [], page: 2, pageSize: 5, total: 0, totalPages: 1 });

    await request(app)
      .get('/vendas?page=2&pageSize=5')
      .set('Authorization', `Bearer ${vendedorToken}`);

    expect(vendasService.listar).toHaveBeenCalledWith({ page: 2, pageSize: 5 }, { id: 2, role: 'vendedor', empresa_id: 1 });
  });

  test('never exposes custo or margem_percentual for an admin or vendedor', async () => {
    vendasService.listar.mockResolvedValue({
      items: [{ id: 1, total: '30.00', itens: [{ produto_id: 1, quantidade: 3, preco_unitario: '10.00' }] }],
      page: 1, pageSize: 20, total: 1, totalPages: 1
    });

    const resAdmin = await request(app).get('/vendas').set('Authorization', `Bearer ${adminToken}`);
    const resVendedor = await request(app).get('/vendas').set('Authorization', `Bearer ${vendedorToken}`);

    for (const res of [resAdmin, resVendedor]) {
      expect(res.status).toBe(200);
      const json = JSON.stringify(res.body);
      expect(json).not.toMatch(/custo|preco_custo|margem_percentual/);
    }
  });
});

describe('GET /vendas/:id (admin and vendedor only)', () => {
  test('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/vendas/abc').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID inválido');
  });

  test('returns 403 for an estoquista', async () => {
    const res = await request(app).get('/vendas/1').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
  });

  test('returns 404 when the service throws (not found, or a vendedor viewing someone else\'s venda)', async () => {
    vendasService.buscarPorId.mockRejectedValue(new AppError('Venda não encontrada', 404));

    const res = await request(app).get('/vendas/999').set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(404);
  });

  test('returns the venda with itens and never exposes custo/margem_percentual', async () => {
    vendasService.buscarPorId.mockResolvedValue({
      id: 1, cliente_id: null, canal: 'loja_fisica', usuario_id: 2, status: 'finalizada', total: '30.00',
      itens: [{ id: 1, produto_id: 1, quantidade: 3, preco_unitario: '10.00' }]
    });

    const res = await request(app).get('/vendas/1').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(vendasService.buscarPorId).toHaveBeenCalledWith(1, { id: 2, role: 'vendedor', empresa_id: 1 });
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/custo|preco_custo|margem_percentual/);
  });
});

describe('PATCH /vendas/:id/cancelar (admin only)', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).patch('/vendas/1/cancelar');
    expect(res.status).toBe(401);
  });

  test('returns 403 for a vendedor', async () => {
    const res = await request(app).patch('/vendas/1/cancelar').set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
    expect(vendasService.cancelar).not.toHaveBeenCalled();
  });

  test('returns 403 for an estoquista', async () => {
    const res = await request(app).patch('/vendas/1/cancelar').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
  });

  test('returns 409 when the venda is not finalizada', async () => {
    vendasService.cancelar.mockRejectedValue(new AppError('Somente vendas finalizadas podem ser canceladas', 409));

    const res = await request(app).patch('/vendas/1/cancelar').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  test('returns 409 when the linked conta a receber is already recebida', async () => {
    vendasService.cancelar.mockRejectedValue(
      new AppError('Venda com conta a receber já recebida não pode ser cancelada', 409)
    );

    const res = await request(app).patch('/vendas/1/cancelar').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Venda com conta a receber já recebida não pode ser cancelada');
  });

  test('cancels and returns the updated venda for an admin, reversing stock', async () => {
    vendasService.cancelar.mockResolvedValue({ id: 1, status: 'cancelada' });

    const res = await request(app).patch('/vendas/1/cancelar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelada');
    expect(vendasService.cancelar).toHaveBeenCalledWith(1, 1, 1);
  });
});
