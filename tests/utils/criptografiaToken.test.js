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

describe('tamanho da tag de autenticação (GCM)', () => {
    const chave = crypto.randomBytes(32);

    test('uma tag TRUNCADA (prefixo da tag verdadeira) é rejeitada, mesmo com o texto cifrado intacto', () => {
        const [versao, iv, tag, cifrado] = cifrar('token-secreto-da-loja', chave).split('.');
        const completa = Buffer.from(tag, 'base64url');

        expect(completa).toHaveLength(16);
        for (const tamanho of [4, 8, 12, 15]) {
            const truncada = completa.subarray(0, tamanho).toString('base64url');

            expect(() => decifrar([versao, iv, truncada, cifrado].join('.'), chave)).toThrow();
        }
    });

    test('tag maior que 16 bytes e IV de tamanho inesperado também são rejeitados', () => {
        const [versao, iv, tag, cifrado] = cifrar('token-secreto-da-loja', chave).split('.');
        const longa = Buffer.concat([Buffer.from(tag, 'base64url'), Buffer.alloc(4)]).toString('base64url');
        const ivCurto = Buffer.from(iv, 'base64url').subarray(0, 8).toString('base64url');

        expect(() => decifrar([versao, iv, longa, cifrado].join('.'), chave)).toThrow();
        expect(() => decifrar([versao, ivCurto, tag, cifrado].join('.'), chave)).toThrow();
    });

    test('o caminho normal continua funcionando (compatível com o que já está gravado)', () => {
        expect(decifrar(cifrar('token-secreto-da-loja', chave), chave)).toBe('token-secreto-da-loja');
    });
});
