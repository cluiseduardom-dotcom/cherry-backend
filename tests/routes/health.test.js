const request = require('supertest');
const app = require('../../src/app');

describe('GET /health', () => {
  test('returns 200 with { status: "ok" }, sem exigir token', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
