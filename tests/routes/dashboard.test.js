jest.mock('../../src/services/dashboardService');

const request = require('supertest');
const dashboardService = require('../../src/services/dashboardService');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const vendedorToken = makeToken({ id: 2, role: 'vendedor', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 3, role: 'estoquista', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

const endpoints = [
  ['/dashboard', 'resumo'],
  ['/dashboard/curva-abc', 'curvaABC'],
  ['/dashboard/giro', 'giro'],
  ['/dashboard/cobertura', 'cobertura'],
  ['/dashboard/margem', 'margem']
];

describe.each(endpoints)('GET %s', (path, serviceMethod) => {
  test('returns 401 without a token', async () => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  test('returns 403 for a vendedor', async () => {
    const res = await request(app).get(path).set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
    expect(dashboardService[serviceMethod]).not.toHaveBeenCalled();
  });

  test('returns 403 for an estoquista', async () => {
    const res = await request(app).get(path).set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
    expect(dashboardService[serviceMethod]).not.toHaveBeenCalled();
  });

  test('returns 200 with the wrapped data for an admin', async () => {
    dashboardService[serviceMethod].mockResolvedValue({ ok: true });

    const res = await request(app).get(path).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: true } });
  });
});

describe('dias query param (giro, cobertura, resumo)', () => {
  test('defaults to 90 when omitted', async () => {
    dashboardService.giro.mockResolvedValue([]);

    await request(app).get('/dashboard/giro').set('Authorization', `Bearer ${adminToken}`);

    expect(dashboardService.giro).toHaveBeenCalledWith(90, 1);
  });

  test('passes an explicit dias through', async () => {
    dashboardService.cobertura.mockResolvedValue([]);

    await request(app).get('/dashboard/cobertura?dias=30').set('Authorization', `Bearer ${adminToken}`);

    expect(dashboardService.cobertura).toHaveBeenCalledWith(30, 1);
  });

  test('falls back to 90 for an invalid dias', async () => {
    dashboardService.giro.mockResolvedValue([]);

    await request(app).get('/dashboard/giro?dias=abc').set('Authorization', `Bearer ${adminToken}`);

    expect(dashboardService.giro).toHaveBeenCalledWith(90, 1);
  });

  test('caps dias at 365', async () => {
    dashboardService.resumo.mockResolvedValue({});

    await request(app).get('/dashboard?dias=9999').set('Authorization', `Bearer ${adminToken}`);

    expect(dashboardService.resumo).toHaveBeenCalledWith(365, 1);
  });
});
