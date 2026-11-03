const { base32Codificar, base32Decodificar, codigoNoPasso, gerarCodigo, gerarSegredo, verificarCodigo, uriOtpauth } = require('../../src/utils/totp');

// Vetores de teste do RFC 6238, apêndice B (SHA1, segredo ASCII "12345678901234567890", 8 dígitos).
const SEGREDO_RFC = Buffer.from('12345678901234567890');

describe('TOTP (RFC 6238)', () => {
    test.each([
        [59, '94287082'],
        [1111111109, '07081804'],
        [1111111111, '14050471'],
        [1234567890, '89005924'],
        [2000000000, '69279037'],
        [20000000000, '65353130']
    ])('t = %i s → %s', (t, esperado) => {
        expect(codigoNoPasso(SEGREDO_RFC, Math.floor(t / 30), 8)).toBe(esperado);
    });

    test('base32 ida e volta', () => {
        const buf = Buffer.from('12345678901234567890');
        expect(base32Codificar(buf)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
        expect(base32Decodificar('GEZD GNBV-GY3TQOJQGEZDGNBVGY3TQOJQ')).toEqual(buf);
    });

    test('segredo novo: 32 caracteres base32 (160 bits) e diferente a cada vez', () => {
        const a = gerarSegredo();
        expect(a).toMatch(/^[A-Z2-7]{32}$/);
        expect(gerarSegredo()).not.toBe(a);
    });

    test('verifica o código atual e ±30 s; recusa fora da janela e formato inválido', () => {
        const segredo = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
        const agora = 1234567890 * 1000;
        const codigo = gerarCodigo(segredo, agora);
        expect(codigo).toBe('005924');
        expect(verificarCodigo(segredo, codigo, agora)).toBe(Math.floor(1234567890 / 30));
        expect(verificarCodigo(segredo, codigo, agora + 30_000)).not.toBeNull();
        expect(verificarCodigo(segredo, codigo, agora + 90_000)).toBeNull();
        expect(verificarCodigo(segredo, '12345', agora)).toBeNull();
        expect(verificarCodigo(segredo, 'abcdef', agora)).toBeNull();
    });

    test('URI otpauth para o app autenticador', () => {
        expect(uriOtpauth({ conta: 'eduardo@gironex.com.br', segredo: 'ABC' }))
            .toBe('otpauth://totp/GiroNex%3Aeduardo%40gironex.com.br?secret=ABC&issuer=GiroNex&algorithm=SHA1&digits=6&period=30');
    });
});
