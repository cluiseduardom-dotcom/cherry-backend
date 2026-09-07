jest.mock('../../src/services/clientesService');

const request = require('supertest');
const clientesService = require('../../src/services/clientesService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const token = makeToken({ id: 1, role: 'vendedor', empresa_id: 1 });
const adminToken = makeToken({ id: 4, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 5, role: 'estoquista', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

test('GET /clientes returns 401 without a token', async () => {
  const res = await request(app).get('/clientes');
  expect(res.status).toBe(401);
});

test('GET /clientes returns the wrapped list', async () => {
  clientesService.listar.mockResolvedValue([{ id: 1, nome: 'Cliente X' }]);

  const res = await request(app).get('/clientes').set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: [{ id: 1, nome: 'Cliente X' }] });
});

test('POST /clientes returns 400 for a missing nome', async () => {
  const res = await request(app)
    .post('/clientes')
    .set('Authorization', `Bearer ${token}`)
    .send({ telefone: '11999999999' });

  expect(res.status).toBe(400);
  expect(res.body.message).toBe('Nome é obrigatório');
});

test('POST /clientes returns 201 on success', async () => {
  clientesService.criar.mockResolvedValue({ id: 1, nome: 'X', telefone: null, email: null });

  const res = await request(app)
    .post('/clientes')
    .set('Authorization', `Bearer ${token}`)
    .send({ nome: 'X' });

  expect(res.status).toBe(201);
  expect(res.body.data.id).toBe(1);
});

test('GET /clientes/:id/total-gasto returns 400 for a non-numeric id', async () => {
  const res = await request(app)
    .get('/clientes/abc/total-gasto')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(400);
  expect(res.body.message).toBe('ID inválido');
  expect(clientesService.totalGasto).not.toHaveBeenCalled();
});

test('GET /clientes/:id/total-gasto returns 404 when the service throws', async () => {
  clientesService.totalGasto.mockRejectedValue(new AppError('Cliente não encontrado', 404));

  const res = await request(app)
    .get('/clientes/999/total-gasto')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(404);
  expect(clientesService.totalGasto).toHaveBeenCalledWith(999, 1);
});

test('GET /clientes/:id/historico returns 200 with the registros', async () => {
  clientesService.historico.mockResolvedValue([{ venda_id: 1 }]);

  const res = await request(app)
    .get('/clientes/1/historico')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.data).toEqual([{ venda_id: 1 }]);
});

test('GET /clientes/ranking returns 200 with the ranking', async () => {
  clientesService.ranking.mockResolvedValue([{ id: 1, total_gasto: 500 }]);

  const res = await request(app).get('/clientes/ranking').set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.data).toEqual([{ id: 1, total_gasto: 500 }]);
});

describe('PATCH /clientes/:id/anonimizar (admin only)', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).patch('/clientes/1/anonimizar');
    expect(res.status).toBe(401);
  });

  test('returns 403 for a vendedor', async () => {
    const res = await request(app).patch('/clientes/1/anonimizar').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(clientesService.anonimizar).not.toHaveBeenCalled();
  });

  test('returns 403 for an estoquista', async () => {
    const res = await request(app)
      .patch('/clientes/1/anonimizar')
      .set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
    expect(clientesService.anonimizar).not.toHaveBeenCalled();
  });

  test('returns 400 for a non-numeric id', async () => {
    const res = await request(app)
      .patch('/clientes/abc/anonimizar')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID inválido');
    expect(clientesService.anonimizar).not.toHaveBeenCalled();
  });

  test('returns 200 with the anonymized data for an admin', async () => {
    clientesService.anonimizar.mockResolvedValue({
      id: 1,
      anonimizado: true,
      anonimizado_em: '2026-09-06T00:00:00.000Z'
    });

    const res = await request(app)
      .patch('/clientes/1/anonimizar')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { id: 1, anonimizado: true, anonimizado_em: '2026-09-06T00:00:00.000Z' }
    });
    expect(clientesService.anonimizar).toHaveBeenCalledWith(1, 1);
  });

  test('returns 409 when the cliente is already anonimizado', async () => {
    clientesService.anonimizar.mockRejectedValue(new AppError('Cliente já foi anonimizado', 409));

    const res = await request(app)
      .patch('/clientes/1/anonimizar')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
  });

  test('returns 404 when the cliente belongs to another empresa', async () => {
    clientesService.anonimizar.mockRejectedValue(new AppError('Cliente não encontrado', 404));

    const res = await request(app)
      .patch('/clientes/999/anonimizar')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});
