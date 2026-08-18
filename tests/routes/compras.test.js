jest.mock('../../src/services/comprasService');

const request = require('supertest');
const comprasService = require('../../src/services/comprasService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('access control (admin + estoquista only)', () => {
  const requests = [
    ['get', '/compras'],
    ['post', '/compras'],
    ['get', '/compras/1'],
    ['patch', '/compras/1/cancelar']
  ];

  test.each(requests)('%s %s returns 401 without a token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  test.each(requests)('%s %s returns 403 for a vendedor', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /compras', () => {
  const validBody = {
    fornecedor_id: 3,
    data_compra: '2026-08-10',
    itens: [{ produto_id: 1, quantidade: 2, custo_unitario: 50 }]
  };

  test('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/compras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fornecedor_id: 3 });

    expect(res.status).toBe(400);
    expect(comprasService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 for an admin, à vista, no conta a pagar generated', async () => {
    comprasService.criar.mockResolvedValue({ id: 1, valor_total: 100, forma_pagamento: 'a_vista', conta_pagar: null });

    const res = await request(app)
      .post('/compras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.conta_pagar).toBeNull();
    expect(comprasService.criar).toHaveBeenCalledWith(
      expect.objectContaining({ fornecedor_id: 3 }),
      1,
      1
    );
  });

  test('returns 201 for an estoquista, a prazo, with a conta a pagar generated', async () => {
    comprasService.criar.mockResolvedValue({
      id: 1, valor_total: 100, forma_pagamento: 'prazo',
      conta_pagar: { id: 5, valor: 100, status: 'pendente' }
    });

    const res = await request(app)
      .post('/compras')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ ...validBody, forma_pagamento: 'prazo', dias_prazo: 30 });

    expect(res.status).toBe(201);
    expect(res.body.data.conta_pagar).toEqual({ id: 5, valor: 100, status: 'pendente' });
  });

  test('returns 404 when the fornecedor belongs to another empresa', async () => {
    comprasService.criar.mockRejectedValue(new AppError('Fornecedor não encontrado', 404));

    const res = await request(app)
      .post('/compras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validBody);

    expect(res.status).toBe(404);
  });

  test('returns 404 when a produto belongs to another empresa', async () => {
    comprasService.criar.mockRejectedValue(new AppError('Produto não encontrado', 404));

    const res = await request(app)
      .post('/compras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validBody);

    expect(res.status).toBe(404);
  });
});

describe('GET /compras (list + filters)', () => {
  const paginatedResult = {
    items: [{ id: 1, fornecedor_id: 3, valor_total: 100 }],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1
  };

  test('returns 200 with the wrapped list for an admin', async () => {
    comprasService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/compras').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: paginatedResult });
  });

  test('returns 200 for an estoquista', async () => {
    comprasService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/compras').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
  });

  test('forwards a fornecedor_id filter', async () => {
    comprasService.listar.mockResolvedValue(paginatedResult);

    await request(app).get('/compras?fornecedor_id=3').set('Authorization', `Bearer ${adminToken}`);

    expect(comprasService.listar).toHaveBeenCalledWith(expect.objectContaining({ fornecedor_id: 3 }), 1);
  });

  test('forwards a data_de/data_ate range', async () => {
    comprasService.listar.mockResolvedValue(paginatedResult);

    await request(app)
      .get('/compras?data_de=2026-01-01&data_ate=2026-12-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(comprasService.listar).toHaveBeenCalledWith(expect.objectContaining({
      dataDe: '2026-01-01',
      dataAte: '2026-12-31'
    }), 1);
  });

  test('returns 400 for an invalid fornecedor_id filter', async () => {
    const res = await request(app).get('/compras?fornecedor_id=-1').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(comprasService.listar).not.toHaveBeenCalled();
  });
});

describe('GET /compras/:id', () => {
  test('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/compras/abc').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID inválido');
  });

  test('returns 404 when the compra does not exist (or belongs to another empresa)', async () => {
    comprasService.buscarPorId.mockRejectedValue(new AppError('Compra não encontrada', 404));

    const res = await request(app).get('/compras/999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('returns 200 with the compra for an admin', async () => {
    const compra = { id: 1, fornecedor_id: 3, valor_total: 100, itens: [] };
    comprasService.buscarPorId.mockResolvedValue(compra);

    const res = await request(app).get('/compras/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(compra);
  });
});

describe('PATCH /compras/:id/cancelar', () => {
  test('returns 200 and cancels the compra for an admin', async () => {
    comprasService.cancelar.mockResolvedValue({ id: 1, status: 'cancelado' });

    const res = await request(app).patch('/compras/1/cancelar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelado');
  });

  test('returns 200 for an estoquista', async () => {
    comprasService.cancelar.mockResolvedValue({ id: 1, status: 'cancelado' });

    const res = await request(app).patch('/compras/1/cancelar').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
  });

  test('returns 409 when the linked conta a pagar is already paga', async () => {
    comprasService.cancelar.mockRejectedValue(
      new AppError('Compra com conta a pagar já paga não pode ser cancelada', 409)
    );

    const res = await request(app).patch('/compras/1/cancelar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
  });

  test('returns 409 when the compra is already cancelada', async () => {
    comprasService.cancelar.mockRejectedValue(
      new AppError('Somente compras recebidas podem ser canceladas', 409)
    );

    const res = await request(app).patch('/compras/1/cancelar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
  });
});
