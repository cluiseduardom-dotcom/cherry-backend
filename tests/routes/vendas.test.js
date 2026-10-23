jest.mock('../../src/services/vendasService');
jest.mock('../../src/services/cancelamentosService');

const request = require('supertest');
const vendasService = require('../../src/services/vendasService');
const cancelamentosService = require('../../src/services/cancelamentosService');
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

describe('analytical sub-routes (admin and vendedor; estoquista não acessa vendas)', () => {
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

  test.each(cases)('GET %s returns 200 for a vendedor', async (path, serviceMethod) => {
    vendasService[serviceMethod].mockResolvedValue({ ok: true });

    const res = await request(app).get(path).set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(vendasService[serviceMethod]).toHaveBeenCalled();
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

  test('POST /vendas — admin recebe custo_unitario dos itens criados', async () => {
    vendasService.criar.mockResolvedValue({
      id: 1, total: '30.00', itens: [{ produto_id: 1, quantidade: 3, preco_unitario: '10.00', custo_unitario: '4.00' }]
    });

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itens: [{ produto_id: 1, quantidade: 3 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.itens[0].custo_unitario).toBe('4.00');
  });

  test('POST /vendas — vendedor NÃO recebe custo_unitario dos itens criados (vazamento)', async () => {
    vendasService.criar.mockResolvedValue({
      id: 1, total: '30.00', itens: [{ produto_id: 1, quantidade: 3, preco_unitario: '10.00', custo_unitario: '4.00' }]
    });

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ itens: [{ produto_id: 1, quantidade: 3 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.itens[0]).not.toHaveProperty('custo_unitario');
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

  test('returns 400 for forma_pagamento prazo without meses_prazo', async () => {
    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ forma_pagamento: 'prazo', itens: [{ produto_id: 1, quantidade: 1 }] });

    expect(res.status).toBe(400);
    expect(vendasService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 for a prazo venda and forwards forma_pagamento/meses_prazo to the service', async () => {
    vendasService.criar.mockResolvedValue({ id: 1, total: '10.00', conta_receber: { id: 1, status: 'pendente' } });

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ forma_pagamento: 'prazo', meses_prazo: 3, itens: [{ produto_id: 1, quantidade: 1 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.conta_receber.status).toBe('pendente');
    expect(vendasService.criar).toHaveBeenCalledWith(
      { forma_pagamento: 'prazo', meses_prazo: 3, itens: [{ produto_id: 1, quantidade: 1 }] },
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

    expect(vendasService.listar).toHaveBeenCalledWith({ page: 2, pageSize: 5, status: undefined, canal: undefined, data_de: undefined, data_ate: undefined }, expect.objectContaining({ id: 2, role: 'vendedor', empresa_id: 1 }));
  });

  test('aceita filtros de status, canal e período', async () => {
    vendasService.listar.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });

    const res = await request(app)
      .get('/vendas?status=finalizada&canal=loja_fisica&data_de=2026-09-01&data_ate=2026-09-30')
      .set('Authorization', 'Bearer ' + adminToken);

    expect(res.status).toBe(200);
    expect(vendasService.listar).toHaveBeenCalledWith(
      {
        page: 1,
        pageSize: 20,
        status: 'finalizada',
        canal: 'loja_fisica',
        data_de: '2026-09-01',
        data_ate: '2026-09-30'
      },
      expect.objectContaining({ id: 1, role: 'admin', empresa_id: 1 })
    );
  });

  test('rejeita período invertido', async () => {
    const res = await request(app)
      .get('/vendas?data_de=2026-09-30&data_ate=2026-09-01')
      .set('Authorization', 'Bearer ' + adminToken);

    expect(res.status).toBe(400);
    expect(vendasService.listar).not.toHaveBeenCalled();
  });

  test('never exposes margem_percentual for an admin or vendedor (não há esse campo em itens de venda)', async () => {
    vendasService.listar.mockResolvedValue({
      items: [{ id: 1, total: '30.00', itens: [{ produto_id: 1, quantidade: 3, preco_unitario: '10.00', custo_unitario: '4.00' }] }],
      page: 1, pageSize: 20, total: 1, totalPages: 1
    });

    const resAdmin = await request(app).get('/vendas').set('Authorization', `Bearer ${adminToken}`);
    const resVendedor = await request(app).get('/vendas').set('Authorization', `Bearer ${vendedorToken}`);

    for (const res of [resAdmin, resVendedor]) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/margem_percentual/);
    }
  });

  test('GET /vendas — admin recebe custo_unitario dos itens', async () => {
    vendasService.listar.mockResolvedValue({
      items: [{ id: 1, total: '30.00', itens: [{ produto_id: 1, quantidade: 3, preco_unitario: '10.00', custo_unitario: '4.00' }] }],
      page: 1, pageSize: 20, total: 1, totalPages: 1
    });

    const res = await request(app).get('/vendas').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0].itens[0].custo_unitario).toBe('4.00');
  });

  test('GET /vendas — vendedor NÃO recebe custo_unitario dos itens (vazamento)', async () => {
    vendasService.listar.mockResolvedValue({
      items: [{ id: 1, total: '30.00', itens: [{ produto_id: 1, quantidade: 3, preco_unitario: '10.00', custo_unitario: '4.00' }] }],
      page: 1, pageSize: 20, total: 1, totalPages: 1
    });

    const res = await request(app).get('/vendas').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0].itens[0]).not.toHaveProperty('custo_unitario');
    expect(JSON.stringify(res.body)).not.toMatch(/custo/);
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

  test('returns the venda with itens and never exposes margem_percentual', async () => {
    vendasService.buscarPorId.mockResolvedValue({
      id: 1, cliente_id: null, canal: 'loja_fisica', usuario_id: 2, status: 'finalizada', total: '30.00',
      itens: [{ id: 1, produto_id: 1, quantidade: 3, preco_unitario: '10.00', custo_unitario: '4.00' }]
    });

    const res = await request(app).get('/vendas/1').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(vendasService.buscarPorId).toHaveBeenCalledWith(1, expect.objectContaining({ id: 2, role: 'vendedor', empresa_id: 1 }));
    expect(JSON.stringify(res.body)).not.toMatch(/margem_percentual/);
  });

  test('GET /vendas/:id — admin recebe custo_unitario dos itens', async () => {
    vendasService.buscarPorId.mockResolvedValue({
      id: 1, cliente_id: null, canal: 'loja_fisica', usuario_id: 2, status: 'finalizada', total: '30.00',
      itens: [{ id: 1, produto_id: 1, quantidade: 3, preco_unitario: '10.00', custo_unitario: '4.00' }]
    });

    const res = await request(app).get('/vendas/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.itens[0].custo_unitario).toBe('4.00');
  });

  test('GET /vendas/:id — vendedor NÃO recebe custo_unitario dos itens (vazamento)', async () => {
    vendasService.buscarPorId.mockResolvedValue({
      id: 1, cliente_id: null, canal: 'loja_fisica', usuario_id: 2, status: 'finalizada', total: '30.00',
      itens: [{ id: 1, produto_id: 1, quantidade: 3, preco_unitario: '10.00', custo_unitario: '4.00' }]
    });

    const res = await request(app).get('/vendas/1').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.itens[0]).not.toHaveProperty('custo_unitario');
  });
});

describe('PATCH /vendas/:id/cancelar (capacidade cancelar_venda; motivo obrigatório)', () => {
  const corpo = { motivo: 'Cliente desistiu da compra' };
  const cancelar = (token, body = corpo, id = 1) =>
    request(app).patch(`/vendas/${id}/cancelar`).set('Authorization', `Bearer ${token}`).send(body);

  test('returns 401 without a token', async () => {
    const res = await request(app).patch('/vendas/1/cancelar').send(corpo);
    expect(res.status).toBe(401);
  });

  test('returns 403 for an estoquista (sem a capacidade)', async () => {
    const res = await cancelar(estoquistaToken);
    expect(res.status).toBe(403);
    expect(cancelamentosService.cancelar).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid id', async () => {
    const res = await cancelar(adminToken, corpo, 'abc');
    expect(res.status).toBe(400);
  });

  test.each([
    ['sem motivo', {}],
    ['motivo vazio', { motivo: '   ' }],
    ['motivo curto demais', { motivo: 'abc' }],
    ['campo desconhecido', { motivo: 'Cliente desistiu', empresa_id: 99 }],
    ['autorizacao sem senha', { motivo: 'Cliente desistiu', autorizacao: { email: 'g@x.com' } }]
  ])('returns 400 %s, without calling the service', async (_nome, body) => {
    const res = await cancelar(adminToken, body);
    expect(res.status).toBe(400);
    expect(cancelamentosService.cancelar).not.toHaveBeenCalled();
  });

  test('returns 409 when the venda is not finalizada', async () => {
    cancelamentosService.cancelar.mockRejectedValue(new AppError('Somente vendas finalizadas podem ser canceladas', 409));

    const res = await cancelar(adminToken);
    expect(res.status).toBe(409);
  });

  test('returns 403 when the authorization is refused', async () => {
    cancelamentosService.cancelar.mockRejectedValue(new AppError('Autorização inválida', 403));

    const res = await cancelar(vendedorToken);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Autorização inválida');
  });

  test('a vendedor can cancel (the policy runs in the service) and the service gets the user, motivo and authorization', async () => {
    cancelamentosService.cancelar.mockResolvedValue({ id: 1, status: 'cancelada' });
    const autorizacao = { email: 'gerente@x.com', senha: 'senha-do-gerente' };

    const res = await cancelar(vendedorToken, { motivo: 'Cliente desistiu da compra', autorizacao });

    expect(res.status).toBe(200);
    expect(cancelamentosService.cancelar).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ id: 2, role: 'vendedor', empresa_id: 1 }),
      { motivo: 'Cliente desistiu da compra', autorizacao }
    );
  });

  test('cancels and returns the updated venda for an admin; empresa_id comes from the token, never the body', async () => {
    cancelamentosService.cancelar.mockResolvedValue({ id: 1, status: 'cancelada' });

    const res = await cancelar(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelada');
    expect(cancelamentosService.cancelar).toHaveBeenCalledWith(1, expect.objectContaining({ id: 1, empresa_id: 1 }), corpo);
  });
});

describe('GET /vendas/:id/cancelamento/previa', () => {
  test('returns 401 without a token and 403 for an estoquista', async () => {
    expect((await request(app).get('/vendas/1/cancelamento/previa')).status).toBe(401);
    const res = await request(app).get('/vendas/1/cancelamento/previa').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
  });

  test('returns the preview for a vendedor', async () => {
    cancelamentosService.previa.mockResolvedValue({ venda_id: 1, faixa: 'ate_7_dias', exige_autorizacao: false });

    const res = await request(app).get('/vendas/1/cancelamento/previa').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.faixa).toBe('ate_7_dias');
    expect(cancelamentosService.previa).toHaveBeenCalledWith(1, expect.objectContaining({ id: 2, empresa_id: 1 }));
  });
});
