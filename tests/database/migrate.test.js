const { inicializarBanco } = require('../../src/database/migrate');

function criarClienteFalso({ possuiEmpresas }) {
    const registradas = [];

    return {
        registradas,
        query: jest.fn(async (sql, params) => {
            if (sql.includes('to_regclass')) return { rows: [{ existe: possuiEmpresas }] };
            if (sql.includes('INSERT INTO schema_migrations')) registradas.push(params[0]);
            return { rows: [] };
        })
    };
}

const migrations = [18, 19, 20, 21, 43].map((versao) => ({ versao, nome: `${versao}_x.sql` }));

describe('inicializarBanco', () => {
    beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
    afterEach(() => jest.restoreAllMocks());

    test('banco vazio registra como baseline só migrations até a 19, deixando as posteriores pendentes', async () => {
        const client = criarClienteFalso({ possuiEmpresas: false });

        await inicializarBanco(client, migrations);

        expect(client.registradas).toEqual([18, 19]);
    });
});
