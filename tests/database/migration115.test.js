const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/115_lancamentos_taxa_forma_comprovante.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 115 — forma de pagamento e comprovante dos lançamentos da taxa', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(115);
    });

    test('não apaga nem reescreve dados e não toca em schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+\w+\s+SET|DROP\s+TABLE|DROP\s+COLUMN)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('renomeia o comprovante para a chave do objeto (S3) só se ainda existir o nome antigo', () => {
        expect(EXECUTAVEL).toMatch(/column_name = 'comprovante'\)[\s\S]*RENAME COLUMN comprovante TO comprovante_chave/);
        expect(EXECUTAVEL).toMatch(/ALTER COLUMN comprovante_chave TYPE VARCHAR\(300\)/);
    });

    test('forma de pagamento em lista fechada, criada uma vez só', () => {
        expect(EXECUTAVEL).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint[\s\S]*ck_lancamentos_taxa_forma_pagamento/);
        expect(EXECUTAVEL).toMatch(/forma_pagamento IN \('pix', 'transferencia', 'boleto'\)/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*RENAME COLUMN comprovante_chave TO comprovante/);
    });
});
