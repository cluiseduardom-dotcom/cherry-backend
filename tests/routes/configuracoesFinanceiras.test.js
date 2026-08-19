jest.mock('../../src/services/configuracoesFinanceirasService');

const request = require('supertest');
const configuracoesFinanceirasService = require('../../src/services/configuracoesFinanceirasService');
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
    ['get', '/configuracoes-financeiras'],
    ['put', '/configuracoes-financeiras']
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

describe('GET /configuracoes-financeiras', () => {
  test('returns 200 with the config for an admin', async () => {
    configuracoesFinanceirasService.obter.mockResolvedValue({ empresa_id: 1, aliquota_imposto: '0.0000' });

    const res = await request(app).get('/configuracoes-financeiras').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.aliquota_imposto).toBe('0.0000');
    expect(configuracoesFinanceirasService.obter).toHaveBeenCalledWith(1);
  });
});

describe('PUT /configuracoes-financeiras', () => {
  test('returns 400 for an invalid aliquota_imposto', async () => {
    const res = await request(app)
      .put('/configuracoes-financeiras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ aliquota_imposto: 1.5 });

    expect(res.status).toBe(400);
    expect(configuracoesFinanceirasService.atualizar).not.toHaveBeenCalled();
  });

  test('returns 200 with the updated config for an admin', async () => {
    configuracoesFinanceirasService.atualizar.mockResolvedValue({ empresa_id: 1, aliquota_imposto: '0.0600' });

    const res = await request(app)
      .put('/configuracoes-financeiras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ aliquota_imposto: 0.06 });

    expect(res.status).toBe(200);
    expect(configuracoesFinanceirasService.atualizar).toHaveBeenCalledWith(1, 0.06);
    expect(res.body.data.aliquota_imposto).toBe('0.0600');
  });
});
