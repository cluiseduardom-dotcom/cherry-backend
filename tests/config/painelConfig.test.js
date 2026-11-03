const crypto = require('node:crypto');
const { obterConfigPainel } = require('../../src/config/painelConfig');

const chave = crypto.randomBytes(32).toString('base64');
const segredo = 'x'.repeat(40);

describe('obterConfigPainel (falha fechada)', () => {
    test('com segredo próprio e chave de 32 bytes: configurado', () => {
        expect(obterConfigPainel({ PAINEL_JWT_SECRET: segredo, PAINEL_ENC_KEY: chave, JWT_SECRET: 'outro' })).not.toBeNull();
    });

    test.each([
        ['sem segredo', { PAINEL_ENC_KEY: chave }],
        ['segredo curto', { PAINEL_JWT_SECRET: 'curto', PAINEL_ENC_KEY: chave }],
        ['segredo igual ao do ERP', { PAINEL_JWT_SECRET: segredo, PAINEL_ENC_KEY: chave, JWT_SECRET: segredo }],
        ['sem chave', { PAINEL_JWT_SECRET: segredo }],
        ['chave com tamanho errado', { PAINEL_JWT_SECRET: segredo, PAINEL_ENC_KEY: crypto.randomBytes(16).toString('base64') }]
    ])('%s: null (o painel responde 503)', (_, env) => {
        expect(obterConfigPainel(env)).toBeNull();
    });
});
