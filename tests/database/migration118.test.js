const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/118_importacao_lista_confirmacao.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 118 — confirmação da importação de lista', () => {
    test('está no runner, depois da 117', async () => {
        const versoes = (await listarMigrations()).map((m) => m.versao);
        expect(versoes).toContain(118);
        expect(versoes.indexOf(118)).toBeGreaterThan(versoes.indexOf(117));
    });

    test('só acrescenta e é idempotente: ADD COLUMN/INDEX IF NOT EXISTS, sem DROP/DELETE/UPDATE/TRUNCATE', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+\w+\s+SET|DROP)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL.match(/ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS/g)).toHaveLength(4);
        expect(EXECUTAVEL.match(/ALTER TABLE/g)).toHaveLength(4);
        expect(EXECUTAVEL.match(/CREATE INDEX (?!IF NOT EXISTS)/g)).toBeNull();
    });

    test('vínculo de auditoria em produtos e clientes, anulável, com FK para importacoes', () => {
        expect(EXECUTAVEL).toMatch(/ALTER TABLE produtos ADD COLUMN IF NOT EXISTS importacao_id INTEGER REFERENCES importacoes\(id\);/);
        expect(EXECUTAVEL).toMatch(/ALTER TABLE clientes ADD COLUMN IF NOT EXISTS importacao_id INTEGER REFERENCES importacoes\(id\);/);
        expect(EXECUTAVEL).not.toMatch(/importacao_id INTEGER NOT NULL/);
    });

    test('relatório em JSONB e quem confirmou, com FK para usuarios', () => {
        expect(EXECUTAVEL).toMatch(/ALTER TABLE importacoes ADD COLUMN IF NOT EXISTS relatorio JSONB;/);
        expect(EXECUTAVEL).toMatch(/ALTER TABLE importacoes ADD COLUMN IF NOT EXISTS confirmada_por INTEGER REFERENCES usuarios\(id\);/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP COLUMN IF EXISTS confirmada_por/);
        expect(SQL).toMatch(/ALTER TABLE produtos DROP COLUMN IF EXISTS importacao_id/);
        expect(SQL).toMatch(/ALTER TABLE clientes DROP COLUMN IF EXISTS importacao_id/);
    });
});
