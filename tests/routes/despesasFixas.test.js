jest.mock('../../src/services/despesasFixasService');

const request = require('supertest');
const despesasFixasService = require('../../src/services/despesasFixasService');
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
    ['get', '/despesas-fixas'],
    ['post', '/despesas-fixas'],
    ['put', '/despesas-fixas/1'],
    ['delete', '/despesas-fixas/1'],
    ['patch', '/despesas-fixas/1/toggle']
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

describe('GET /despesas-fixas', () => {
  test('returns 200 with the wrapped list for an admin', async () => {
    const despesas = [{ id: 1, categoria: 'estrutural', descricao: 'Aluguel', valor: '3500.00', ativo: true }];
    despesasFixasService.listar.mockResolvedValue(despesas);

    const res = await request(app).get('/despesas-fixas').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: despesas });
    expect(despesasFixasService.listar).toHaveBeenCalledWith(1);
  });
});

describe('POST /despesas-fixas', () => {
  const validBody = { categoria: 'pessoal', descricao: 'Salários', valor: 5000 };

  test('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/despesas-fixas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ descricao: 'Salários' });

    expect(res.status).toBe(400);
    expect(despesasFixasService.criar).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid categoria', async () => {
    const res = await request(app)
      .post('/despesas-fixas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validBody, categoria: 'variavel' });

    expect(res.status).toBe(400);
  });

  test('returns 201 for an admin', async () => {
    despesasFixasService.criar.mockResolvedValue({ id: 1, ...validBody, ativo: true });

    const res = await request(app)
      .post('/despesas-fixas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
    expect(despesasFixasService.criar).toHaveBeenCalledWith(validBody, 1);
  });
});

describe('PUT /despesas-fixas/:id', () => {
  test('returns 400 for an empty body', async () => {
    const res = await request(app)
      .put('/despesas-fixas/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('returns 200 with the updated despesa for an admin', async () => {
    despesasFixasService.atualizar.mockResolvedValue({ id: 1, valor: 200 });

    const res = await request(app)
      .put('/despesas-fixas/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: 200 });

    expect(res.status).toBe(200);
    expect(despesasFixasService.atualizar).toHaveBeenCalledWith(1, { valor: 200 }, 1);
  });

  test('returns 404 when the service throws', async () => {
    despesasFixasService.atualizar.mockRejectedValue(new AppError('Despesa fixa não encontrada', 404));

    const res = await request(app)
      .put('/despesas-fixas/999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: 200 });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /despesas-fixas/:id', () => {
  test('returns 200 and soft-deletes for an admin', async () => {
    despesasFixasService.remover.mockResolvedValue({ id: 1, deletado_em: '2026-08-19' });

    const res = await request(app).delete('/despesas-fixas/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deletado_em).toBe('2026-08-19');
  });

  test('returns 404 when the service throws', async () => {
    despesasFixasService.remover.mockRejectedValue(new AppError('Despesa fixa não encontrada', 404));

    const res = await request(app).delete('/despesas-fixas/999').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /despesas-fixas/:id/toggle', () => {
  test('returns 200 and toggles ativo for an admin', async () => {
    despesasFixasService.alternarAtivo.mockResolvedValue({ id: 1, ativo: false });

    const res = await request(app).patch('/despesas-fixas/1/toggle').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ativo).toBe(false);
  });

  test('returns 404 when the service throws', async () => {
    despesasFixasService.alternarAtivo.mockRejectedValue(new AppError('Despesa fixa não encontrada', 404));

    const res = await request(app).patch('/despesas-fixas/999/toggle').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});
