jest.mock('../../src/config/db', () => ({ query: jest.fn(), end: jest.fn() }));

const request = require('supertest');
const app = require('../../src/app');

describe('GET /health', () => {
  test('returns 200 with { status: "ok" }, sem exigir token', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /health/ready', () => {
  // O banco é simulado (mock do módulo): este teste não abre conexão real.
  const { query } = require('../../src/config/db');
  afterEach(() => query.mockReset());

  test('banco responde: 200, sem token e sem cache', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('banco falha: 503 sem vazar o erro, o host nem a credencial', async () => {
    query.mockRejectedValue(new Error('connect ECONNREFUSED postgres://usuario:segredo@host'));

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'indisponivel' });
    expect(JSON.stringify(res.body)).not.toMatch(/segredo|postgres|ECONNREFUSED/);
  });
});
