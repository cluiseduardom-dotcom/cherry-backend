'use strict';

const { VARIAVEIS_PG } = require('./variaveisPg');

const ENV_ORIGINAL = { ...process.env };
afterEach(() => {
    jest.resetModules();
    jest.dontMock('pg');
    for (const chave of [...VARIAVEIS_PG, 'DATABASE_URL', 'DATABASE_MIGRATION_URL', 'TEST_DATABASE_URL']) {
        if (ENV_ORIGINAL[chave] === undefined) delete process.env[chave];
        else process.env[chave] = ENV_ORIGINAL[chave];
    }
});

describe('bootstrap dos testes unitários (setupBloqueioBanco)', () => {
    test('remove as variáveis PG*, a URL de migração e TEST_DATABASE_URL, e aponta DATABASE_URL para um destino que recusa', () => {
        for (const chave of VARIAVEIS_PG) process.env[chave] = 'x';
        process.env.DATABASE_MIGRATION_URL = 'postgresql://m:m@db.exemplo/m?sslmode=verify-full';
        process.env.TEST_DATABASE_URL = 'postgresql://t:t@localhost/cherry_test';

        jest.isolateModules(() => require('../setupBloqueioBanco'));

        for (const chave of VARIAVEIS_PG) expect(process.env[chave]).toBeUndefined();
        expect(process.env.DATABASE_MIGRATION_URL).toBe('');
        expect(process.env.TEST_DATABASE_URL).toBeUndefined();
        expect(new URL(process.env.DATABASE_URL).host).toBe('127.0.0.1:1');
    });

    test('importar db.js não abre conexão: o Pool é criado sem connect/query e com URL validada', () => {
        jest.isolateModules(() => require('../setupBloqueioBanco'));
        const pool = { connect: jest.fn(), query: jest.fn() };
        const Pool = jest.fn(() => pool);

        jest.isolateModules(() => {
            jest.doMock('pg', () => ({ Pool }));
            require('../../src/config/db');
        });

        expect(Pool).toHaveBeenCalledTimes(1);
        expect(pool.connect).not.toHaveBeenCalled();
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('db.js força TLS verificado em host remoto, qualquer que seja o sslmode da URL', () => {
        for (const sslmode of ['require', 'no-verify', 'disable', 'prefer', 'verify-full']) {
            const Pool = jest.fn();
            process.env.DATABASE_URL = `postgresql://u:p@db.exemplo/x?sslmode=${sslmode}`;
            jest.isolateModules(() => {
                jest.doMock('pg', () => ({ Pool }));
                require('../../src/config/db');
            });
            expect(Pool).toHaveBeenCalledTimes(1);
            expect(Pool.mock.calls[0][0].ssl).toEqual({ rejectUnauthorized: true });
            expect(Pool.mock.calls[0][0].connectionString).not.toMatch(/sslmode/);
        }
    });

    test('db.js rejeita URL local que sobrescreve o destino, antes de criar o Pool', () => {
        const Pool = jest.fn();
        process.env.DATABASE_URL = 'postgresql://u:p@localhost/x?host=db.exemplo';
        expect(() => jest.isolateModules(() => {
            jest.doMock('pg', () => ({ Pool }));
            require('../../src/config/db');
        })).toThrow('não pode sobrescrever o destino');
        expect(Pool).not.toHaveBeenCalled();
    });
});
