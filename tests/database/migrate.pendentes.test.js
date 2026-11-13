const { migrationsPendentes } = require('../../src/database/migrate');

const migrations = [1, 2, 3].map((versao) => ({ versao, nome: `${versao}_x.sql` }));

function clienteFalso({ existeTabela = true, aplicadas = [] }) {
    return {
        query: jest.fn(async (sql) => {
            if (sql.includes('to_regclass')) return { rows: [{ existe: existeTabela }] };
            if (sql.includes('FROM schema_migrations')) return { rows: aplicadas.map((version) => ({ version })) };
            return { rows: [] };
        })
    };
}

describe('migrationsPendentes (somente leitura)', () => {
    test('tudo aplicado: nada pendente', async () => {
        await expect(migrationsPendentes(clienteFalso({ aplicadas: [1, 2, 3] }), migrations)).resolves.toEqual([]);
    });

    test('faltando algumas: devolve só as que faltam', async () => {
        const pendentes = await migrationsPendentes(clienteFalso({ aplicadas: [1] }), migrations);

        expect(pendentes.map((m) => m.versao)).toEqual([2, 3]);
    });

    test('banco sem a tabela de controle: tudo pendente', async () => {
        const pendentes = await migrationsPendentes(clienteFalso({ existeTabela: false }), migrations);

        expect(pendentes).toHaveLength(3);
    });

    test('nunca escreve: só SELECT/to_regclass', async () => {
        const client = clienteFalso({ aplicadas: [1] });
        await migrationsPendentes(client, migrations);

        for (const [sql] of client.query.mock.calls) expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i);
    });
});
