jest.mock('../../src/services/authService');

const request = require('supertest');
const authService = require('../../src/services/authService');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /auth/login', () => {
  test('returns 400 for an invalid body', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Email inválido' });
    expect(authService.login).not.toHaveBeenCalled();
  });

  test('returns 200 with the service result on success', async () => {
    authService.login.mockResolvedValue({ token: 'tok', usuario: { id: 1, papel: 'admin' } });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@x.com', senha: 'senha123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { token: 'tok', usuario: { id: 1, papel: 'admin' } }
    });
    expect(authService.login).toHaveBeenCalledWith('a@x.com', 'senha123');
  });

  test('propagates a service AppError with its status code', async () => {
    const AppError = require('../../src/errors/AppError');
    authService.login.mockRejectedValue(new AppError('Email ou senha inválidos', 401));

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@x.com', senha: 'senha-errada' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: 'Email ou senha inválidos' });
  });
});

describe('POST /auth/register', () => {
  const validBody = { nome: 'X', email: 'x@x.com', senha: 'senha123', papel: 'vendedor' };

  test('returns 401 without a token', async () => {
    const res = await request(app).post('/auth/register').send(validBody);
    expect(res.status).toBe(401);
  });

  test('returns 403 for a non-admin token', async () => {
    const token = makeToken({ id: 2, role: 'vendedor' });

    const res = await request(app)
      .post('/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(403);
    expect(authService.register).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid body even with an admin token', async () => {
    const token = makeToken({ id: 1, role: 'admin' });

    const res = await request(app)
      .post('/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validBody, papel: 'superadmin' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Papel inválido');
  });

  test('returns 201 and creates the user for an admin token', async () => {
    const token = makeToken({ id: 1, role: 'admin' });
    authService.register.mockResolvedValue({
      usuario: { id: 9, nome: 'X', email: 'x@x.com', papel: 'vendedor' }
    });

    const res = await request(app)
      .post('/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.usuario.id).toBe(9);
    expect(authService.register).toHaveBeenCalledWith('X', 'x@x.com', 'senha123', 'vendedor');
  });
});
