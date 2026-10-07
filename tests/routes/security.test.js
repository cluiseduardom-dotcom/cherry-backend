const request = require('supertest');
const app = require('../../src/app');

describe('segurança HTTP', () => {
  test('envia headers de segurança do Helmet', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('permite origem configurada', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCorsOrigins = process.env.CORS_ORIGINS;
    const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS;

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.cherry.com.br';
    process.env.TRUST_PROXY_HOPS = '2';

    jest.resetModules();
    const secureApp = require('../../src/app');

    const res = await request(secureApp)
      .get('/health')
      .set('Origin', 'https://app.cherry.com.br');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.cherry.com.br');

    process.env.NODE_ENV = originalNodeEnv;
    process.env.CORS_ORIGINS = originalCorsOrigins;
    if (originalTrustProxyHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = originalTrustProxyHops;
  });
});
