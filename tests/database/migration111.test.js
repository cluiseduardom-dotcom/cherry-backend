const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/111_rotulo_estoque_vendedor.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 111 — rótulo do estoque do vendedor', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(111);
    });

    test('é só aditiva e idempotente: sem DELETE/UPDATE/DROP/TRUNCATE e sem schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|DROP)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL).toMatch(/ADD COLUMN IF NOT EXISTS rotulo_estoque_vendedor/);
    });

    test('empresas existentes ficam com maleta; as novas nascem com estoque_vendedor; lista fechada por CHECK', () => {
        expect(EXECUTAVEL).toMatch(/rotulo_estoque_vendedor VARCHAR\(20\) NOT NULL DEFAULT 'maleta'/);
        expect(EXECUTAVEL).toMatch(/ALTER COLUMN rotulo_estoque_vendedor SET DEFAULT 'estoque_vendedor'/);
        expect(EXECUTAVEL).toMatch(/CHECK \(rotulo_estoque_vendedor IN \('maleta', 'estoque_vendedor'\)\)/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP CONSTRAINT IF EXISTS empresas_rotulo_estoque_vendedor_chk[\s\S]*DROP COLUMN IF EXISTS rotulo_estoque_vendedor/);
    });
});
