const { aplicarMigration } = require('../../src/database/migrate');

function clienteFalso({ jaAplicada }) {
    const comandos = [];

    return {
        comandos,
        query: jest.fn(async (sql) => {
            comandos.push(sql.trim().split('\n')[0]);
            if (sql.startsWith('SELECT 1 FROM schema_migrations')) return { rows: jaAplicada ? [{ '?column?': 1 }] : [] };
            return { rows: [] };
        })
    };
}

describe('aplicarMigration: trava e conferência dentro da transação', () => {
    test('migration já aplicada por outro processo: não roda o SQL, só confirma a transação', async () => {
        const client = clienteFalso({ jaAplicada: true });

        await expect(aplicarMigration(client, { versao: 5, nome: '005_x.sql' })).resolves.toBe(false);

        expect(client.comandos).toEqual(['BEGIN', expect.stringContaining('pg_advisory_xact_lock'), expect.stringContaining('SELECT 1 FROM schema_migrations'), 'COMMIT']);
    });

    test('a trava é pedida antes de conferir (ordem: BEGIN, trava, conferência)', async () => {
        const client = clienteFalso({ jaAplicada: true });

        await aplicarMigration(client, { versao: 5, nome: '005_x.sql' });

        const ordem = client.comandos.map((c) => (c.includes('pg_advisory_xact_lock') ? 'trava' : c.includes('SELECT 1') ? 'confere' : c));
        expect(ordem.indexOf('trava')).toBeLessThan(ordem.indexOf('confere'));
    });

    test('erro no SQL: ROLLBACK e o erro sobe', async () => {
        const client = clienteFalso({ jaAplicada: false });
        client.query.mockImplementation(async (sql) => {
            client.comandos.push(sql.trim().split('\n')[0]);
            if (sql.startsWith('SELECT 1 FROM schema_migrations')) return { rows: [] };
            if (sql.startsWith('SELECT pg_advisory')) return { rows: [] };
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
            throw new Error('falhou');
        });

        await expect(aplicarMigration(client, { versao: 5, nome: 'inexistente.sql' }, '/tmp/nao-existe')).rejects.toThrow();

        expect(client.comandos.at(-1)).toBe('ROLLBACK');
    });
});
