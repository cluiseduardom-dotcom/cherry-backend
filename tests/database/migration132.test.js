const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/132_fks_compostas_empresa.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 132 — FKs compostas (id, empresa_id)', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(132);
    });

    test('só acrescenta: sem DROP/DELETE FROM/TRUNCATE/UPDATE/INSERT, sem tocar em schema_migrations', () => {
        // `ON DELETE` (ação da FK) é DDL e é permitido; apagar ou alterar dados não.
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|TRUNCATE|UPDATE|INSERT)\b|\bDELETE\s+FROM\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('é idempotente: todo índice usa IF NOT EXISTS e toda FK é condicionada à inexistência', () => {
        expect(EXECUTAVEL.match(/CREATE UNIQUE INDEX (?!IF NOT EXISTS)/g)).toBeNull();
        expect(EXECUTAVEL).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = fk\.nome AND conrelid = fk\.tabela::regclass\)/);
    });

    test('FKs entram NOT VALID e a validação do legado nunca derruba o deploy (WARNING)', () => {
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(%I, empresa_id\) REFERENCES %I \(id, empresa_id\) ON DELETE %s NOT VALID/);
        expect(EXECUTAVEL).toMatch(/VALIDATE CONSTRAINT/);
        expect(EXECUTAVEL).toMatch(/EXCEPTION WHEN foreign_key_violation THEN\s+RAISE WARNING/);
    });

    test('cada constraint tem nome único e dentro do limite de 63 caracteres do Postgres', () => {
        const nomes = [...EXECUTAVEL.matchAll(/\('([a-z_0-9]+)', '([a-z_0-9]+_empresa_fk)'/g)].map((m) => m[2]);
        expect(nomes.length).toBeGreaterThanOrEqual(100);
        expect(new Set(nomes).size).toBe(nomes.length);
        nomes.forEach((n) => expect(n.length).toBeLessThanOrEqual(63));
    });

    test('preserva o ON DELETE da FK simples: só itens_venda -> vendas é CASCADE', () => {
        const cascades = [...EXECUTAVEL.matchAll(/\('([a-z_0-9]+)', '[a-z_0-9]+', '([a-z_0-9]+)', '([a-z_0-9]+)', 'CASCADE'\)/g)];
        expect(cascades.map((m) => `${m[1]}.${m[2]}->${m[3]}`)).toEqual(['itens_venda.venda_id->vendas']);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP CONSTRAINT IF EXISTS/);
    });
});
