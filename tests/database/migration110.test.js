const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/110_recebimentos_idempotencia.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 110 — idempotência dos recebimentos', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(110);
    });

    test('é só aditiva e idempotente: uma coluna e um índice, sem DELETE/UPDATE/DROP/TRUNCATE', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|DROP)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL).toMatch(/ADD COLUMN IF NOT EXISTS chave_idempotencia VARCHAR\(80\)/);
        expect(EXECUTAVEL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_recebimentos_conta_chave/);
    });

    test('a chave nasce NULL e a unicidade vale só quando há chave, por empresa', () => {
        expect(EXECUTAVEL).not.toMatch(/NOT NULL/i);
        expect(EXECUTAVEL).toMatch(/\(empresa_id, chave_idempotencia\)\s+WHERE chave_idempotencia IS NOT NULL/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP INDEX IF EXISTS uq_recebimentos_conta_chave[\s\S]*DROP COLUMN IF EXISTS chave_idempotencia/);
    });
});
