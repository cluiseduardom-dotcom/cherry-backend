// Integração de verdade (Postgres de testes, já migrado pela CI): o modo "migrations fora do boot" aceita um banco
// em dia e recusa quando falta migration.
const { verificarMigrationsAplicadas } = require('../../src/database/migrate');
const { Pool } = require('pg');

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const pool = new Pool({ connectionString: url, max: 1 });
let antes;

beforeAll(() => { process.env.DATABASE_URL = url; });
afterAll(async () => { await pool.end(); });

test('banco em dia: confere sem erro', async () => {
    await expect(verificarMigrationsAplicadas()).resolves.toBeUndefined();
});

test('falta uma migration registrada: recusa com mensagem clara (e restaura o registro)', async () => {
    const { rows } = await pool.query('SELECT version, filename FROM schema_migrations ORDER BY version DESC LIMIT 1');
    antes = rows[0];
    expect(antes).toBeDefined();

    await pool.query('DELETE FROM schema_migrations WHERE version = $1', [antes.version]);
    try {
        await expect(verificarMigrationsAplicadas()).rejects.toThrow(new RegExp('Migrations pendentes \\(' + antes.version + '\\).*db:migrate'));
    } finally {
        await pool.query('INSERT INTO schema_migrations (version, filename) VALUES ($1, $2) ON CONFLICT DO NOTHING', [antes.version, antes.filename]);
    }
});
