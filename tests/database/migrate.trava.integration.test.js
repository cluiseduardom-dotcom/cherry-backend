// Integração de verdade (Postgres de testes): dois processos aplicando a MESMA migration ao mesmo tempo.
// Sem a trava, o segundo rodaria o SQL de novo (CREATE TABLE falharia). Usa uma migration descartável em pasta temporária.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { aplicarMigration } = require('../../src/database/migrate');

const VERSAO = 999999;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL, max: 3 });
let pasta;

beforeAll(() => {
    pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(pasta, '999999_trava.sql'), 'CREATE TABLE tmp_migration_trava (id INT); SELECT pg_sleep(0.4);');
});

afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS tmp_migration_trava');
    await pool.query('DELETE FROM schema_migrations WHERE version = $1', [VERSAO]);
    await pool.end();
    fs.rmSync(pasta, { recursive: true, force: true });
});

test('duas execuções simultâneas: o SQL roda uma vez só e a outra reconhece que já foi aplicada', async () => {
    const [a, b] = await Promise.all([pool.connect(), pool.connect()]);
    const migration = { versao: VERSAO, nome: '999999_trava.sql' };

    try {
        const resultados = await Promise.all([aplicarMigration(a, migration, pasta), aplicarMigration(b, migration, pasta)]);

        expect(resultados.sort()).toEqual([false, true]);
        const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations WHERE version = $1', [VERSAO]);
        expect(rows[0].n).toBe(1);
    } finally {
        a.release();
        b.release();
    }
});
