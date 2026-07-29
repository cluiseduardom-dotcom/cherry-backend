jest.mock('../../src/services/contasPagarService');

const request = require('supertest');
const contasPagarService = require('../../src/services/contasPagarService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const vendedorToken = makeToken({ id: 2, role: 'vendedor', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 3, role: 'estoquista', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('access control (admin only)', () => {
  const requests = [
    ['get', '/contas-pagar'],
    ['post', '/contas-pagar'],
    ['get', '/contas-pagar/1'],
    ['put', '/contas-pagar/1'],
    ['patch', '/contas-pagar/1/pagar'],
    ['delete', '/contas-pagar/1']
  ];

  test.each(requests)('%s %s returns 401 without a token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  test.each(requests)('%s %s returns 403 for a vendedor', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
  });

  test.each(requests)('%s %s returns 403 for an estoquista', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /contas-pagar (list + filters)', () => {
  const paginatedResult = {
    items: [{ id: 1, descricao: 'Aluguel', valor: '1500.00', status: 'pendente', data_vencimento: '2026-08-10', atrasado: false }],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1
  };

  test('returns 200 with the wrapped list for an admin', async () => {
    contasPagarService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/contas-pagar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: paginatedResult });
  });

  test('parses page/pageSize query params', async () => {
    contasPagarService.listar.mockResolvedValue(paginatedResult);

    await request(app).get('/contas-pagar?page=2&pageSize=5').set('Authorization', `Bearer ${adminToken}`);

    expect(contasPagarService.listar).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 5 }), 1);
  });

  test('falls back to defaults for invalid pagination params', async () => {
    contasPagarService.listar.mockResolvedValue(paginatedResult);

    await request(app).get('/contas-pagar?page=abc&pageSize=-1').set('Authorization', `Bearer ${adminToken}`);

    expect(contasPagarService.listar).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }), 1);
  });

  test('forwards a status filter', async () => {
    contasPagarService.listar.mockResolvedValue(paginatedResult);

    await request(app).get('/contas-pagar?status=pago').set('Authorization', `Bearer ${adminToken}`);

    expect(contasPagarService.listar).toHaveBeenCalledWith(expect.objectContaining({ status: 'pago' }), 1);
  });

  test('returns 400 for an invalid status filter', async () => {
    const res = await request(app).get('/contas-pagar?status=quitada').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(contasPagarService.listar).not.toHaveBeenCalled();
  });

  test('forwards a vencimento_de/vencimento_ate date range', async () => {
    contasPagarService.listar.mockResolvedValue(paginatedResult);

    await request(app)
      .get('/contas-pagar?vencimento_de=2026-01-01&vencimento_ate=2026-12-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(contasPagarService.listar).toHaveBeenCalledWith(expect.objectContaining({
      vencimentoDe: '2026-01-01',
      vencimentoAte: '2026-12-31'
    }), 1);
  });
});

describe('GET /contas-pagar/:id', () => {
  test('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/contas-pagar/abc').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID inválido');
  });

  test('returns 404 when the service throws', async () => {
    contasPagarService.buscarPorId.mockRejectedValue(new AppError('Conta a pagar não encontrada', 404));

    const res = await request(app).get('/contas-pagar/999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('returns 200 with the conta for an admin', async () => {
    const conta = { id: 1, descricao: 'Aluguel', valor: '1500.00', status: 'pendente', atrasado: false };
    contasPagarService.buscarPorId.mockResolvedValue(conta);

    const res = await request(app).get('/contas-pagar/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(conta);
  });
});

describe('POST /contas-pagar', () => {
  const validBody = { descricao: 'Aluguel', valor: 1500, data_vencimento: '2026-08-10' };

  test('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/contas-pagar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ descricao: 'Aluguel' });

    expect(res.status).toBe(400);
    expect(contasPagarService.criar).not.toHaveBeenCalled();
  });

  test('returns 400 for a valor of zero', async () => {
    const res = await request(app)
      .post('/contas-pagar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validBody, valor: 0 });

    expect(res.status).toBe(400);
  });

  test('returns 400 for a negative valor', async () => {
    const res = await request(app)
      .post('/contas-pagar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validBody, valor: -50 });

    expect(res.status).toBe(400);
  });

  test('returns 201 and attaches the requesting usuario_id for an admin', async () => {
    contasPagarService.criar.mockResolvedValue({ id: 1, ...validBody, status: 'pendente' });

    const res = await request(app)
      .post('/contas-pagar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
    expect(contasPagarService.criar).toHaveBeenCalledWith(
      expect.objectContaining({ descricao: 'Aluguel', valor: 1500 }),
      1,
      1
    );
  });
});

describe('PUT /contas-pagar/:id', () => {
  test('returns 400 for an empty body', async () => {
    const res = await request(app)
      .put('/contas-pagar/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Informe ao menos um campo para atualizar');
  });

  test('returns 200 with the updated conta for an admin', async () => {
    contasPagarService.atualizar.mockResolvedValue({ id: 1, valor: '200.00' });

    const res = await request(app)
      .put('/contas-pagar/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: 200 });

    expect(res.status).toBe(200);
    expect(contasPagarService.atualizar).toHaveBeenCalledWith(1, { valor: 200 }, 1);
  });

  test('returns 409 when the conta is not pendente', async () => {
    contasPagarService.atualizar.mockRejectedValue(
      new AppError('Contas pagas ou canceladas não podem ser editadas', 409)
    );

    const res = await request(app)
      .put('/contas-pagar/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: 200 });

    expect(res.status).toBe(409);
  });
});

describe('PATCH /contas-pagar/:id/pagar', () => {
  test('returns 200 and marks the conta paga for an admin', async () => {
    contasPagarService.marcarComoPaga.mockResolvedValue({ id: 1, status: 'pago', data_pagamento: '2026-07-27' });

    const res = await request(app).patch('/contas-pagar/1/pagar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pago');
  });

  test('returns 409 when the conta is not pendente', async () => {
    contasPagarService.marcarComoPaga.mockRejectedValue(
      new AppError('Somente contas pendentes podem ser marcadas como pagas', 409)
    );

    const res = await request(app).patch('/contas-pagar/1/pagar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
  });
});

describe('DELETE /contas-pagar/:id', () => {
  test('returns 200 and cancels the conta for an admin', async () => {
    contasPagarService.cancelar.mockResolvedValue({ id: 1, status: 'cancelado' });

    const res = await request(app).delete('/contas-pagar/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelado');
  });

  test('returns 409 when the conta is not pendente', async () => {
    contasPagarService.cancelar.mockRejectedValue(
      new AppError('Somente contas pendentes podem ser canceladas', 409)
    );

    const res = await request(app).delete('/contas-pagar/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
  });
});
