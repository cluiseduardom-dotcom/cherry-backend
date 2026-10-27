const crypto = require('node:crypto');
const { obterConfigMercadoPago, OBRIGATORIAS } = require('../../src/config/mercadoPagoConfig');

const env = () => ({
    MP_APP_ID: '123',
    MP_CLIENT_SECRET: 's',
    MP_REDIRECT_URI: 'https://api.test/integracoes/mercadopago/callback',
    MP_WEBHOOK_SECRET: 'w',
    MP_WEBHOOK_URL: 'https://api.test/webhooks/mercadopago',
    MP_TOKEN_ENC_KEY: crypto.randomBytes(32).toString('base64'),
    MP_FRONTEND_URL: 'https://app.test/'
});

describe('obterConfigMercadoPago', () => {
    test('com tudo configurado devolve a config (sem barra final, padrões de URL, sandbox desligado)', () => {
        const config = obterConfigMercadoPago(env());
        expect(config.frontendUrl).toBe('https://app.test');
        expect(config.apiUrl).toBe('https://api.mercadopago.com');
        expect(config.authUrl).toBe('https://auth.mercadopago.com');
        expect(config.sandbox).toBe(false);
        expect(config.chaveCifra).toHaveLength(32);
    });

    test.each(OBRIGATORIAS)('sem %s a integração fica desligada', (nome) => {
        const e = env();
        delete e[nome];
        expect(obterConfigMercadoPago(e)).toBeNull();
        expect(obterConfigMercadoPago({ ...e, [nome]: '   ' })).toBeNull();
    });

    test('chave de cifra que não tem 32 bytes desliga a integração', () => {
        expect(obterConfigMercadoPago({ ...env(), MP_TOKEN_ENC_KEY: crypto.randomBytes(16).toString('base64') })).toBeNull();
    });

    test('MP_SANDBOX=true liga o modo de teste', () => {
        expect(obterConfigMercadoPago({ ...env(), MP_SANDBOX: 'true' }).sandbox).toBe(true);
    });
});
