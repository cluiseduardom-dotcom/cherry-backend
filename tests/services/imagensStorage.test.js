const { configurado, urlPublica } = require('../../src/services/storage/imagensStorage');

const completo = { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' };

describe('imagensStorage', () => {
    test('só considera configurado com conta, chave, segredo e bucket', () => {
        expect(configurado(completo)).toBe(true);
        for (const faltando of Object.keys(completo)) {
            const { [faltando]: _omitida, ...resto } = completo;
            expect(configurado(resto)).toBe(false);
        }
        expect(configurado({})).toBe(false);
    });

    test('URL pública usa a base configurada sem barra final; sem base devolve null', () => {
        expect(urlPublica('3/produtos/7/a.jpg', { R2_PUBLIC_BASE_URL: 'https://fotos.exemplo.test/' })).toBe('https://fotos.exemplo.test/3/produtos/7/a.jpg');
        expect(urlPublica('3/produtos/7/a.jpg', { R2_PUBLIC_BASE_URL: '' })).toBeNull();
        expect(urlPublica('3/produtos/7/a.jpg', {})).toBeNull();
        expect(urlPublica(null, { R2_PUBLIC_BASE_URL: 'https://x.test' })).toBeNull();
    });
});
