jest.mock('../../src/services/precosService');

const request = require('supertest');
const precosService = require('../../src/services/precosService');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin' });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista' });
const vendedorToken = makeToken({ id: 3, role: 'vendedor' });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /canais-venda', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).get('/canais-venda');
    expect(res.status).toBe(401);
  });

  test.each([
    ['admin', adminToken],
    ['estoquista', estoquistaToken],
    ['vendedor', vendedorToken]
  ])('is available to a %s', async (_role, token) => {
    precosService.listarCanais.mockResolvedValue([
      { id: 1, nome: 'loja_fisica', ativo: true },
      { id: 2, nome: 'online', ativo: true }
    ]);

    const res = await request(app).get('/canais-venda').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});
