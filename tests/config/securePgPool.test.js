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

    test('rejeita override de host que poderia redirecionar URL local para servidor remoto', () => {
        expect(() => criarPoolSeguro('postgresql://user:pass@localhost:5432/app?host=db.example.com'))
            .toThrow('não pode sobrescrever o destino');
        expect(Pool).not.toHaveBeenCalled();
    });

    test('mantém PostgreSQL local utilizável sem exigir TLS', () => {
        criarPoolSeguro('postgresql://user:pass@localhost:5432/app');
        expect(Pool.mock.calls[0][0].ssl).toBeUndefined();
    });

    test.each(['host', 'hostaddr', 'port', 'dbname', 'user', 'password', 'service', 'socket'])(
        'rejeita o parâmetro de destino %s na query, em URL local ou remota',
        (parametro) => {
            for (const base of ['postgresql://u:p@localhost:5432/app', 'postgresql://u:p@db.example.com/app']) {
                expect(() => criarPoolSeguro(`${base}?${parametro}=x`)).toThrow('não pode sobrescrever o destino');
            }
            expect(Pool).not.toHaveBeenCalled();
        }
    );

    test('mensagens de erro não vazam usuário, senha nem host', () => {
        const urls = [
            'postgresql://USUARIO:SEGREDO@localhost/app?host=HOST-REMOTO',
            'mysql://USUARIO:SEGREDO@HOST-REMOTO/app',
            'postgresql://USUARIO:SEGREDO@[HOST-REMOTO'
        ];
        for (const url of urls) {
            expect(() => criarPoolSeguro(url)).toThrow();
            try { criarPoolSeguro(url); } catch (erro) {
                expect(erro.message).not.toMatch(/USUARIO|SEGREDO|HOST-REMOTO/);
            }
        }
    });
});

// Usa o driver real (sem mock) para provar a configuração TLS EFETIVA depois que o pg
// mescla a connection string com o `ssl` explícito: sslmode da URL não pode enfraquecê-la.
describe('criarPoolSeguro — configuração TLS efetiva no pg instalado', () => {
    const ConnectionParameters = jest.requireActual('pg/lib/connection-parameters');

    test.each(['require', 'no-verify', 'disable', 'prefer', 'allow', 'verify-ca', 'verify-full'])(
        'sslmode=%s em host remoto resulta em certificado verificado',
        (sslmode) => {
            criarPoolSeguro(`postgresql://u:p@ep-exemplo.neon.tech/app?sslmode=${sslmode}&channel_binding=require`);
            const efetiva = new ConnectionParameters(Pool.mock.calls[0][0]);
            expect(efetiva.ssl).toEqual({ rejectUnauthorized: true });
            expect(efetiva.host).toBe('ep-exemplo.neon.tech');
        }
    );

    test('ssl=false e uselibpqcompat também não desligam a validação', () => {
        criarPoolSeguro('postgresql://u:p@ep-exemplo.neon.tech/app?ssl=false&uselibpqcompat=true&sslmode=require');
        const efetiva = new ConnectionParameters(Pool.mock.calls[0][0]);
        expect(efetiva.ssl).toEqual({ rejectUnauthorized: true });
    });
});
