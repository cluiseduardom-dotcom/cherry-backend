const {
    MARCADOR_BANCO_DESCARTAVEL, limparVariaveisDeConexao, variaveisPgPresentes, verificarBancoDescartavel
} = require('../../src/config/testDatabaseSafety');
const { validarUrlDeBanco, validarUrlDeBancoDescartavel } = require('../../src/config/databaseUrl');

describe('proteção do ambiente de testes', () => {
    test('remove todas as variáveis de conexão conhecidas', () => {
        const env = {
            DATABASE_URL: 'postgresql://invalida',
            PGHOST: 'host-invalido',
            PGPORT: '5432',
            PGDATABASE: 'banco-invalido',
            PGUSER: 'usuario-invalido',
            PGPASSWORD: 'senha-invalida',
            PGSSLMODE: 'no-verify',
            PGSERVICE: 'servico-invalido'
        };

        limparVariaveisDeConexao(env);

        expect(env).toEqual({});
    });

    test('detecta variáveis PG* que redirecionam a conexão', () => {
        expect(variaveisPgPresentes({ PGHOST: 'x', JWT_SECRET: 'y' })).toEqual(['PGHOST']);
        expect(variaveisPgPresentes({ JWT_SECRET: 'y' })).toEqual([]);
    });
});

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

describe('validarUrlDeBancoDescartavel', () => {
    test('aceita só loopback, sem query e com nome de banco de teste', () => {
        expect(validarUrlDeBancoDescartavel('postgresql://u:p@127.0.0.1:5433/cherry_test').banco).toBe('cherry_test');
    });

    test.each([
        undefined,
        'postgresql://u:p@db.exemplo:5432/cherry_test',
        'postgresql://u:p@localhost:5432/cherry',
        'postgresql://u:p@localhost:5432/cherry_test?host=db.exemplo',
        'postgresql://u:p@localhost:5432/cherry_test?sslmode=disable',
        'postgresql://u:p@localhost:5432/',
        'postgresql://u:p@localhost.:5432/cherry_test'
    ])('rejeita %#', (url) => {
        expect(() => validarUrlDeBancoDescartavel(url)).toThrow();
    });
});

describe('verificarBancoDescartavel (cliente falso, sem rede)', () => {
    const URL_OK = 'postgresql://u:p@localhost:5433/cherry_test';
    const clienteFalso = (linha) => {
        const client = { connect: jest.fn(), end: jest.fn(), query: jest.fn(async () => ({ rows: linha ? [linha] : [] })) };
        return { client, Ctor: jest.fn(() => client) };
    };
    const linhaOk = { banco: 'cherry_test', endereco: '127.0.0.1', comentario: MARCADOR_BANCO_DESCARTAVEL };

    test('aceita banco com marcador em loopback e sempre fecha a conexão', async () => {
        const { client, Ctor } = clienteFalso(linhaOk);
        await expect(verificarBancoDescartavel(URL_OK, Ctor)).resolves.toBeUndefined();
        expect(client.end).toHaveBeenCalled();
    });

    test.each([
        ['sem marcador', { ...linhaOk, comentario: null }, /marcador/],
        ['servidor remoto (túnel)', { ...linhaOk, endereco: '10.1.2.3' }, /loopback/],
        ['banco diferente do declarado', { ...linhaOk, banco: 'producao' }, /difere/]
    ])('bloqueia %s', async (_nome, linha, erro) => {
        const { client, Ctor } = clienteFalso(linha);
        await expect(verificarBancoDescartavel(URL_OK, Ctor)).rejects.toThrow(erro);
        expect(client.end).toHaveBeenCalled();
    });

    test('URL não loopback é recusada antes de criar qualquer cliente', async () => {
        const { Ctor } = clienteFalso(linhaOk);
        await expect(verificarBancoDescartavel('postgresql://u:p@db.exemplo/cherry_test', Ctor)).rejects.toThrow();
        expect(Ctor).not.toHaveBeenCalled();
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
