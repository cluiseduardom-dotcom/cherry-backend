jest.mock('../../src/services/fornecedoresService');

const request = require('supertest');
const fornecedoresService = require('../../src/services/fornecedoresService');
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
    ['get', '/fornecedores'],
    ['post', '/fornecedores'],
    ['get', '/fornecedores/1'],
    ['put', '/fornecedores/1'],
    ['delete', '/fornecedores/1']
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

describe('GET /fornecedores (list + busca por nome)', () => {
  const paginatedResult = {
    items: [{ id: 1, nome: 'Metais & Cia', ativo: true }],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1
  };

  test('returns 200 with the wrapped list for an admin', async () => {
    fornecedoresService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/fornecedores').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: paginatedResult });
  });

  test('returns 200 for an estoquista', async () => {
    fornecedoresService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/fornecedores').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
  });

  test('forwards a nome filter', async () => {
    fornecedoresService.listar.mockResolvedValue(paginatedResult);

    await request(app).get('/fornecedores?nome=Metais').set('Authorization', `Bearer ${adminToken}`);

    expect(fornecedoresService.listar).toHaveBeenCalledWith(expect.objectContaining({ nome: 'Metais' }), 1);
  });

  test('omits the nome filter when not provided', async () => {
    fornecedoresService.listar.mockResolvedValue(paginatedResult);

    await request(app).get('/fornecedores').set('Authorization', `Bearer ${adminToken}`);

    expect(fornecedoresService.listar).toHaveBeenCalledWith(expect.objectContaining({ nome: undefined }), 1);
  });

  test('falls back to defaults for invalid pagination params', async () => {
    fornecedoresService.listar.mockResolvedValue(paginatedResult);

    await request(app).get('/fornecedores?page=abc&pageSize=-1').set('Authorization', `Bearer ${adminToken}`);

    expect(fornecedoresService.listar).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }), 1);
  });
});

describe('GET /fornecedores/:id', () => {
  test('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/fornecedores/abc').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID inválido');
  });

  test('returns 404 when the fornecedor does not exist (or belongs to another empresa)', async () => {
    fornecedoresService.buscarPorId.mockRejectedValue(new AppError('Fornecedor não encontrado', 404));

    const res = await request(app).get('/fornecedores/999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('returns 200 with the fornecedor for an admin', async () => {
    const fornecedor = { id: 1, nome: 'Metais & Cia', ativo: true };
    fornecedoresService.buscarPorId.mockResolvedValue(fornecedor);

    const res = await request(app).get('/fornecedores/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(fornecedor);
  });
});

describe('POST /fornecedores', () => {
  test('returns 400 for a missing nome', async () => {
    const res = await request(app)
      .post('/fornecedores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Nome é obrigatório');
    expect(fornecedoresService.criar).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid cnpj_cpf', async () => {
    const res = await request(app)
      .post('/fornecedores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Metais & Cia', cnpj_cpf: '123' });

    expect(res.status).toBe(400);
  });

  test('returns 201 for an admin', async () => {
    fornecedoresService.criar.mockResolvedValue({ id: 1, nome: 'Metais & Cia', ativo: true });

    const res = await request(app)
      .post('/fornecedores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Metais & Cia' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
    expect(fornecedoresService.criar).toHaveBeenCalledWith(expect.objectContaining({ nome: 'Metais & Cia' }), 1);
  });

  test('returns 201 for an estoquista', async () => {
    fornecedoresService.criar.mockResolvedValue({ id: 1, nome: 'Metais & Cia', ativo: true });

    const res = await request(app)
      .post('/fornecedores')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ nome: 'Metais & Cia' });

    expect(res.status).toBe(201);
  });
});

describe('PUT /fornecedores/:id', () => {
  test('returns 400 for an empty body', async () => {
    const res = await request(app)
      .put('/fornecedores/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Informe ao menos um campo para atualizar');
  });

  test('returns 200 with the updated fornecedor for an admin', async () => {
    fornecedoresService.atualizar.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const res = await request(app)
      .put('/fornecedores/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(200);
    expect(fornecedoresService.atualizar).toHaveBeenCalledWith(1, { nome: 'Novo Nome' }, 1);
  });

  test('returns 404 when the fornecedor belongs to another empresa', async () => {
    fornecedoresService.atualizar.mockRejectedValue(new AppError('Fornecedor não encontrado', 404));

    const res = await request(app)
      .put('/fornecedores/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /fornecedores/:id', () => {
  test('returns 200 and soft-deletes (ativo = false) for an admin', async () => {
    fornecedoresService.remover.mockResolvedValue({ id: 1, ativo: false });

    const res = await request(app).delete('/fornecedores/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ativo).toBe(false);
  });

  test('returns 200 for an estoquista', async () => {
    fornecedoresService.remover.mockResolvedValue({ id: 1, ativo: false });

    const res = await request(app).delete('/fornecedores/1').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
  });

  test('returns 404 when the fornecedor belongs to another empresa', async () => {
    fornecedoresService.remover.mockRejectedValue(new AppError('Fornecedor não encontrado', 404));

    const res = await request(app).delete('/fornecedores/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});
