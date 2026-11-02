const crypto = require('node:crypto');
const { obterConfigMercadoPago, lerParcelasMaximasLink, OBRIGATORIAS } = require('../../src/config/mercadoPagoConfig');

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

    test('MP_EMAIL_PAGADOR_PADRAO é opcional: válido entra aparado; ausente ou inválido vira null sem desligar a integração', () => {
        expect(obterConfigMercadoPago(env()).emailPagadorPadrao).toBeNull();
        expect(obterConfigMercadoPago({ ...env(), MP_EMAIL_PAGADOR_PADRAO: '  pagamentos@plataforma.test ' }).emailPagadorPadrao).toBe('pagamentos@plataforma.test');

        const invalido = obterConfigMercadoPago({ ...env(), MP_EMAIL_PAGADOR_PADRAO: 'nao-e-email' });
        expect(invalido).not.toBeNull();
        expect(invalido.emailPagadorPadrao).toBeNull();
    });

    test('MP_LINK_PARCELAS_MAXIMAS: padrão 12; aceita inteiro de 1 a 24; qualquer outra coisa volta ao padrão', () => {
        expect(obterConfigMercadoPago(env()).parcelasMaximasLink).toBe(12);
        expect(obterConfigMercadoPago({ ...env(), MP_LINK_PARCELAS_MAXIMAS: ' 6 ' }).parcelasMaximasLink).toBe(6);
        expect(lerParcelasMaximasLink('1')).toBe(1);
        expect(lerParcelasMaximasLink('24')).toBe(24);

        for (const invalido of ['0', '25', '-3', '6.5', 'seis', '', undefined, null, '100', '1e1']) {
            expect(lerParcelasMaximasLink(invalido)).toBe(12);
        }
    });

    test('chave de cifra que não tem 32 bytes desliga a integração', () => {
        expect(obterConfigMercadoPago({ ...env(), MP_TOKEN_ENC_KEY: crypto.randomBytes(16).toString('base64') })).toBeNull();
    });

    test('MP_SANDBOX=true liga o modo de teste', () => {
        expect(obterConfigMercadoPago({ ...env(), MP_SANDBOX: 'true' }).sandbox).toBe(true);
    });
});
