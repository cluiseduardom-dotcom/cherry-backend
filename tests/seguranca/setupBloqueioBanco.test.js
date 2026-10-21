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

    test('db.js rejeita no-verify mesmo em localhost e URL remota sem verify-full, antes de criar o Pool', () => {
        const Pool = jest.fn();

        for (const url of ['postgresql://u:p@localhost/x?sslmode=no-verify', 'postgresql://u:p@db.exemplo/x?sslmode=require']) {
            process.env.DATABASE_URL = url;
            expect(() => jest.isolateModules(() => {
                jest.doMock('pg', () => ({ Pool }));
                require('../../src/config/db');
            })).toThrow();
        }
        expect(Pool).not.toHaveBeenCalled();
    });
});
