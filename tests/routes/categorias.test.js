jest.mock('../../src/services/categoriasService');

const request = require('supertest');
const categoriasService = require('../../src/services/categoriasService');
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
    ['get', '/categorias'],
    ['post', '/categorias'],
    ['put', '/categorias/1'],
    ['delete', '/categorias/1']
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

describe('GET /categorias', () => {
  const paginatedResult = { items: [{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }], page: 1, pageSize: 20, total: 1, totalPages: 1 };

  test('returns 200 for an admin', async () => {
    categoriasService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/categorias').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: paginatedResult });
  });

  test('returns 200 for an estoquista', async () => {
    categoriasService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/categorias').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(200);
  });

  test('falls back to defaults for invalid pagination params', async () => {
    categoriasService.listar.mockResolvedValue(paginatedResult);

    await request(app).get('/categorias?page=abc&pageSize=-1').set('Authorization', `Bearer ${adminToken}`);

    expect(categoriasService.listar).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }), 1);
  });

  test('caps pageSize at 100', async () => {
    categoriasService.listar.mockResolvedValue(paginatedResult);

    await request(app).get('/categorias?pageSize=500').set('Authorization', `Bearer ${adminToken}`);

    expect(categoriasService.listar).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 }), 1);
  });
});

describe('POST /categorias', () => {
  test('returns 400 for a missing codigo', async () => {
    const res = await request(app)
      .post('/categorias')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, nome: 'Brinco' });

    expect(res.status).toBe(400);
    expect(categoriasService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 for an admin', async () => {
    categoriasService.criar.mockResolvedValue({ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' });

    const res = await request(app)
      .post('/categorias')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, codigo: 'BR', nome: 'Brinco' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
  });

  test('returns 201 for an estoquista', async () => {
    categoriasService.criar.mockResolvedValue({ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' });

    const res = await request(app)
      .post('/categorias')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ nivel: 1, codigo: 'BR', nome: 'Brinco' });

    expect(res.status).toBe(201);
  });

  test('returns 409 when the service reports a duplicate codigo', async () => {
    categoriasService.criar.mockRejectedValue(new AppError('Já existe uma categoria com esse código neste nível', 409));

    const res = await request(app)
      .post('/categorias')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, codigo: 'BR', nome: 'Brinco' });

    expect(res.status).toBe(409);
  });
});

describe('PUT /categorias/:id', () => {
  test('returns 200 with the updated categoria for an admin', async () => {
    categoriasService.atualizar.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const res = await request(app)
      .put('/categorias/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(200);
    expect(categoriasService.atualizar).toHaveBeenCalledWith(1, { nome: 'Novo Nome' }, 1);
  });

  test('returns 200 with the updated categoria for an estoquista', async () => {
    categoriasService.atualizar.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const res = await request(app)
      .put('/categorias/1')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(200);
  });

  test('returns 400 with an explicit message when codigo is in the body', async () => {
    const res = await request(app)
      .put('/categorias/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X', codigo: 'ZZ' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/não podem ser alterados/);
    expect(categoriasService.atualizar).not.toHaveBeenCalled();
  });

  test('returns 400 with an explicit message when nivel is in the body', async () => {
    const res = await request(app)
      .put('/categorias/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X', nivel: 2 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/não podem ser alterados/);
    expect(categoriasService.atualizar).not.toHaveBeenCalled();
  });

  test('returns 404 when the categoria does not belong to this empresa', async () => {
    categoriasService.atualizar.mockRejectedValue(new AppError('Categoria não encontrada', 404));

    const res = await request(app)
      .put('/categorias/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /categorias/:id', () => {
  test('returns 200 and soft-deletes for an estoquista', async () => {
    categoriasService.remover.mockResolvedValue({ id: 1, deletado_em: '2026-09-12T00:00:00.000Z' });

    const res = await request(app).delete('/categorias/1').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deletado_em).toBeTruthy();
  });

  test('returns 200 and soft-deletes for an admin', async () => {
    categoriasService.remover.mockResolvedValue({ id: 1, deletado_em: '2026-09-12T00:00:00.000Z' });

    const res = await request(app).delete('/categorias/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deletado_em).toBeTruthy();
  });

  test('returns 404 when the categoria does not belong to this empresa', async () => {
    categoriasService.remover.mockRejectedValue(new AppError('Categoria não encontrada', 404));

    const res = await request(app).delete('/categorias/1').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
