'use strict';

jest.mock('pg', () => ({
    Pool: jest.fn(function Pool(config) { this.config = config; })
}));

const { Pool } = require('pg');
const { criarPoolSeguro } = require('../../src/config/securePgPool');

describe('criarPoolSeguro', () => {
    beforeEach(() => Pool.mockClear());

    test('exige uma URL PostgreSQL', () => {
        expect(() => criarPoolSeguro()).toThrow('DATABASE_URL não configurada');
        expect(() => criarPoolSeguro('mysql://localhost/db')).toThrow('URL de conexão PostgreSQL inválida');
        expect(Pool).not.toHaveBeenCalled();
    });

    test('força TLS e validação de certificado em host remoto', () => {
        criarPoolSeguro('postgresql://user:pass@db.example.com:5432/app?sslmode=require');
        expect(Pool).toHaveBeenCalledTimes(1);
        const config = Pool.mock.calls[0][0];
        expect(config.ssl).toEqual({ rejectUnauthorized: true });
        expect(config.connectionString).not.toMatch(/[?&]sslmode=/i);
    });

    test('remove os parâmetros SSL que poderiam conflitar com a configuração TLS explícita', () => {
        criarPoolSeguro('postgresql://user:pass@db.example.com/app?sslmode=no-verify&ssl=false');
        const config = Pool.mock.calls[0][0];
        expect(config.ssl).toEqual({ rejectUnauthorized: true });
        expect(config.connectionString).not.toMatch(/[?&]ssl(mode)?=/i);
    });

    test('mantém PostgreSQL local utilizável sem exigir TLS', () => {
        criarPoolSeguro('postgresql://user:pass@localhost:5432/app');
        expect(Pool.mock.calls[0][0].ssl).toBeUndefined();
    });
});
