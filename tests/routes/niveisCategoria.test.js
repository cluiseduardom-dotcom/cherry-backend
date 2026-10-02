jest.mock('../../src/services/niveisCategoriaService');

const request = require('supertest');
const niveisCategoriaService = require('../../src/services/niveisCategoriaService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });
const outraEmpresaAdminToken = makeToken({ id: 4, role: 'admin', empresa_id: 2 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('access control (admin + estoquista only)', () => {
  const requests = [
    ['get', '/niveis-categoria'],
    ['post', '/niveis-categoria'],
    ['put', '/niveis-categoria/1'],
    ['delete', '/niveis-categoria/1']
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

describe('GET /niveis-categoria', () => {
  test('returns 200 for an admin', async () => {
    niveisCategoriaService.listar.mockResolvedValue([{ id: 1, nivel: 1, nome: 'Família' }]);

    const res = await request(app).get('/niveis-categoria').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ id: 1, nivel: 1, nome: 'Família' }] });
    expect(niveisCategoriaService.listar).toHaveBeenCalledWith(1);
  });

  test('returns 200 for an estoquista', async () => {
    niveisCategoriaService.listar.mockResolvedValue([]);

    const res = await request(app).get('/niveis-categoria').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(200);
  });

  test('scopes strictly by the caller empresa_id (isolation)', async () => {
    niveisCategoriaService.listar.mockResolvedValue([]);

    await request(app).get('/niveis-categoria').set('Authorization', `Bearer ${outraEmpresaAdminToken}`);

    expect(niveisCategoriaService.listar).toHaveBeenCalledWith(2);
  });
});

describe('POST /niveis-categoria', () => {
  test('returns 400 for a missing nome', async () => {
    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1 });

    expect(res.status).toBe(400);
    expect(niveisCategoriaService.criar).not.toHaveBeenCalled();
  });

  test('returns 400 for a missing nivel', async () => {
    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Família' });

    expect(res.status).toBe(400);
    expect(niveisCategoriaService.criar).not.toHaveBeenCalled();
  });

  test('returns 400 for an extra unknown field (strict schema)', async () => {
    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, nome: 'Família', codigo: 'ZZ' });

    expect(res.status).toBe(400);
    expect(niveisCategoriaService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 for an admin', async () => {
    niveisCategoriaService.criar.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família' });

    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, nome: 'Família' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
  });

  test('returns 201 for an estoquista', async () => {
    niveisCategoriaService.criar.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família' });

    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ nivel: 1, nome: 'Família' });

    expect(res.status).toBe(201);
  });

  test('returns 409 when the service reports a duplicate nivel', async () => {
    niveisCategoriaService.criar.mockRejectedValue(new AppError('Já existe um rótulo para este nível', 409));

    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, nome: 'Família' });

    expect(res.status).toBe(409);
  });
});

describe('PUT /niveis-categoria/:id', () => {
  test('returns 200 with the updated nivel for an admin', async () => {
    niveisCategoriaService.atualizar.mockResolvedValue({ id: 1, nivel: 1, nome: 'Novo Nome' });

    const res = await request(app)
      .put('/niveis-categoria/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(200);
    expect(niveisCategoriaService.atualizar).toHaveBeenCalledWith(1, { nome: 'Novo Nome' }, 1);
  });

  test('returns 200 for an estoquista', async () => {
    niveisCategoriaService.atualizar.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const res = await request(app)
      .put('/niveis-categoria/1')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(200);
  });

  test('returns 400 with an explicit message when nivel is in the body', async () => {
    const res = await request(app)
      .put('/niveis-categoria/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X', nivel: 2 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/não pode ser alterado/);
    expect(niveisCategoriaService.atualizar).not.toHaveBeenCalled();
  });

  test('returns 400 for an extra unknown field (strict schema)', async () => {
    const res = await request(app)
      .put('/niveis-categoria/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X', codigo: 'ZZ' });

    expect(res.status).toBe(400);
    expect(niveisCategoriaService.atualizar).not.toHaveBeenCalled();
  });

  test('returns 404 when the nivel does not belong to this empresa', async () => {
    niveisCategoriaService.atualizar.mockRejectedValue(new AppError('Nível não encontrado', 404));

    const res = await request(app)
      .put('/niveis-categoria/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /niveis-categoria/:id', () => {
  test('returns 200 for an admin', async () => {
    niveisCategoriaService.remover.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família' });

    const res = await request(app).delete('/niveis-categoria/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  test('returns 200 for an estoquista', async () => {
    niveisCategoriaService.remover.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família' });

    const res = await request(app).delete('/niveis-categoria/1').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(200);
  });

  test('returns 404 when the nivel does not belong to this empresa', async () => {
    niveisCategoriaService.remover.mockRejectedValue(new AppError('Nível não encontrado', 404));

    const res = await request(app).delete('/niveis-categoria/1').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
