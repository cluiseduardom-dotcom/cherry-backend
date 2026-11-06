const request = require('supertest');
const app = require('../../src/app');

describe('segurança HTTP', () => {
  // production/staging exigem TRUST_PROXY_HOPS explícito para o app carregar.
  const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS;

  beforeEach(() => {
    process.env.TRUST_PROXY_HOPS = '2';
  });

  afterEach(() => {
    if (originalTrustProxyHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = originalTrustProxyHops;
  });

  test('envia headers de segurança do Helmet', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('permite origem configurada', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCorsOrigins = process.env.CORS_ORIGINS;

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.cherry.com.br';

    jest.resetModules();
    const secureApp = require('../../src/app');

    const res = await request(secureApp)
      .get('/health')
      .set('Origin', 'https://app.cherry.com.br');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.cherry.com.br');

    process.env.NODE_ENV = originalNodeEnv;
    process.env.CORS_ORIGINS = originalCorsOrigins;
  });

  test('aceita também a origem do Painel GiroNex (PAINEL_CORS_ORIGINS) sem tirar a do ERP', async () => {
    const original = { NODE_ENV: process.env.NODE_ENV, CORS_ORIGINS: process.env.CORS_ORIGINS, PAINEL_CORS_ORIGINS: process.env.PAINEL_CORS_ORIGINS };

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.cherry.com.br';
    process.env.PAINEL_CORS_ORIGINS = 'https://painel.gironex.com.br';

    jest.resetModules();
    const secureApp = require('../../src/app');

    for (const origem of ['https://app.cherry.com.br', 'https://painel.gironex.com.br']) {
      const res = await request(secureApp).get('/health').set('Origin', origem);
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(origem);
    }
    const outra = await request(secureApp).get('/health').set('Origin', 'https://outra.com');
    expect(outra.status).toBe(403);

    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  test('aceita também as origens do site público (SITE_CORS_ORIGINS, várias separadas por vírgula) sem tirar as demais', async () => {
    const original = { NODE_ENV: process.env.NODE_ENV, CORS_ORIGINS: process.env.CORS_ORIGINS, PAINEL_CORS_ORIGINS: process.env.PAINEL_CORS_ORIGINS, SITE_CORS_ORIGINS: process.env.SITE_CORS_ORIGINS };

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.cherry.com.br';
    process.env.PAINEL_CORS_ORIGINS = 'https://painel.gironex.com.br';
    process.env.SITE_CORS_ORIGINS = 'https://www.vertumno.com.br, https://vertumno.com.br';

    jest.resetModules();
    const secureApp = require('../../src/app');

    for (const origem of ['https://app.cherry.com.br', 'https://painel.gironex.com.br', 'https://www.vertumno.com.br', 'https://vertumno.com.br']) {
      const res = await request(secureApp).get('/health').set('Origin', origem);
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(origem);
    }
    // a comparação é exata: outro subdomínio, outro esquema ou outro domínio continuam bloqueados
    for (const origem of ['https://outra.com', 'http://www.vertumno.com.br', 'https://evil.vertumno.com.br']) {
      const res = await request(secureApp).get('/health').set('Origin', origem);
      expect(res.status).toBe(403);
    }

    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  test('não usa o bypass permissivo em staging quando CORS_ORIGINS não está configurado (mesmo hardening de produção)', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCorsOrigins = process.env.CORS_ORIGINS;

    process.env.NODE_ENV = 'staging';
    delete process.env.CORS_ORIGINS;

    jest.resetModules();
    const stagingApp = require('../../src/app');

    const res = await request(stagingApp)
      .get('/health')
      .set('Origin', 'https://origem-qualquer.com');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: 'Origem não permitida pelo CORS' });

    process.env.NODE_ENV = originalNodeEnv;
    process.env.CORS_ORIGINS = originalCorsOrigins;
  });

  test('permite origem configurada em staging', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCorsOrigins = process.env.CORS_ORIGINS;

    process.env.NODE_ENV = 'staging';
    process.env.CORS_ORIGINS = 'https://staging.cherry.com.br';

    jest.resetModules();
    const stagingApp = require('../../src/app');

    const res = await request(stagingApp)
      .get('/health')
      .set('Origin', 'https://staging.cherry.com.br');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://staging.cherry.com.br');

    process.env.NODE_ENV = originalNodeEnv;
    process.env.CORS_ORIGINS = originalCorsOrigins;
  });
});
