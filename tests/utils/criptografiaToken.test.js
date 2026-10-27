const crypto = require('node:crypto');
const { cifrar, decifrar } = require('../../src/utils/criptografiaToken');

const chave = crypto.randomBytes(32);

describe('criptografiaToken', () => {
    test('cifra e decifra de volta, sem deixar o texto puro no resultado', () => {
        const cifrado = cifrar('APP_USR-segredo-123', chave);
        expect(cifrado).not.toContain('APP_USR');
        expect(cifrado.startsWith('v1.')).toBe(true);
        expect(decifrar(cifrado, chave)).toBe('APP_USR-segredo-123');
    });

    test('IV aleatório: o mesmo texto gera cifrados diferentes', () => {
        expect(cifrar('x', chave)).not.toBe(cifrar('x', chave));
    });

    test('chave errada ou adulteração falham (GCM autentica)', () => {
        const cifrado = cifrar('segredo', chave);
        expect(() => decifrar(cifrado, crypto.randomBytes(32))).toThrow();
        const partes = cifrado.split('.');
        partes[3] = Buffer.from('adulterado').toString('base64url');
        expect(() => decifrar(partes.join('.'), chave)).toThrow();
    });

    test('formato inválido e texto vazio são recusados', () => {
        expect(() => decifrar('lixo', chave)).toThrow('Formato');
        expect(() => decifrar('v2.a.b.c', chave)).toThrow('Formato');
        expect(() => cifrar('', chave)).toThrow();
        expect(() => cifrar(undefined, chave)).toThrow();
    });
});
