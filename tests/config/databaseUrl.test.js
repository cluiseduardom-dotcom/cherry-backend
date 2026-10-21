const { validarUrlDeBanco } = require('../../src/config/databaseUrl');

describe('validarUrlDeBanco', () => {
    test('aceita destino remoto somente com verify-full', () => {
        const url = 'postgresql://usuario:senha@db.exemplo:5432/cherry?sslmode=verify-full';
        expect(validarUrlDeBanco(url)).toBe(url);
    });

    test.each([
        'postgresql://usuario:senha@db.exemplo:5432/cherry',
        'postgresql://usuario:senha@db.exemplo:5432/cherry?sslmode=require',
        'postgresql://usuario:senha@db.exemplo:5432/cherry?sslmode=no-verify',
        'postgresql://usuario:senha@db.exemplo:5432/cherry?sslmode=disable',
        'postgresql://usuario:senha@db.exemplo:5432/cherry?sslmode=verify-ca'
    ])('rejeita modo TLS inseguro em destino remoto', (url) => {
        expect(() => validarUrlDeBanco(url)).toThrow(/sslmode=verify-full/i);
    });

    test('aceita PostgreSQL local sem TLS para o serviço efêmero de CI', () => {
        expect(validarUrlDeBanco('postgresql://usuario:senha@localhost:5432/cherry_ci'))
            .toContain('localhost');
    });
});

describe('validarUrlDeBanco — brechas de destino e TLS', () => {
    test.each([
        'postgresql://u:p@localhost:5432/cherry?host=db.exemplo',
        'postgresql://u:p@localhost:5432/cherry?hostaddr=10.0.0.1',
        'postgresql://u:p@localhost:5432/cherry?port=5433',
        'postgresql://u:p@localhost:5432/cherry?sslmode=no-verify',
        'postgresql://u:p@localhost:5432/cherry?ssl=false',
        'postgresql://u:p@db.exemplo:5432/cherry?sslmode=verify-full&sslmode=no-verify',
        'postgresql://u:p@db.exemplo:5432/cherry?sslmode=verify-full&ssl=0',
        'postgresql://u:p@db.exemplo:5432/cherry?sslmode=verify-full&host=outro.exemplo',
        'postgresql:///cherry',
        'mysql://u:p@localhost/cherry'
    ])('rejeita %#', (url) => {
        expect(() => validarUrlDeBanco(url)).toThrow();
    });

    test('mensagens de erro não vazam a URL', () => {
        try {
            validarUrlDeBanco('postgresql://usuario:SEGREDO@db.exemplo:5432/cherry?sslmode=no-verify');
        } catch (erro) {
            expect(erro.message).not.toMatch(/SEGREDO|usuario|db\.exemplo/);
        }
    });
});

// Fixa a semântica do driver instalado (sem rede): verify-full valida certificado e
// hostname (rejectUnauthorized nunca é false); só no-verify desliga a validação.
describe('semântica de TLS do pg-connection-string instalado', () => {
    const { parse } = require('pg-connection-string');
    const base = 'postgresql://u:p@db.exemplo:5432/cherry?channel_binding=require&sslmode=';

    test('verify-full mantém a validação do certificado ligada', () => {
        const { ssl } = parse(`${base}verify-full`);
        expect(ssl).toBeTruthy();
        expect(ssl.rejectUnauthorized).not.toBe(false);
    });

    test('no-verify desliga a validação (por isso o validador o rejeita antes)', () => {
        expect(parse(`${base}no-verify`).ssl.rejectUnauthorized).toBe(false);
        expect(() => validarUrlDeBanco(`${base}no-verify`)).toThrow();
    });
});
