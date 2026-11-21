const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { FUNCIONALIDADES } = require('../../src/constants/funcionalidades');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/121_pcp_vendavel.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 121 — PCP passa a poder ser ligado pela GiroNex', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(121);
    });

    test('só liga o flag `vendavel` da funcionalidade pcp: um UPDATE, sem DDL, sem apagar nada', () => {
        expect(EXECUTAVEL).toMatch(/UPDATE funcionalidades SET vendavel = true WHERE codigo = 'pcp'/);
        expect(EXECUTAVEL.match(/\bUPDATE\b/gi)).toHaveLength(1);
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP|ALTER|CREATE|INSERT)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('nenhum plano passa a incluir o PCP (a GiroNex liga avulso, por empresa)', () => {
        expect(EXECUTAVEL).not.toMatch(/plano_funcionalidades|empresa_funcionalidades/i);
    });

    test('a constante do catálogo coincide com o resultado da migration', () => {
        expect(FUNCIONALIDADES.find((f) => f.codigo === 'pcp').vendavel).toBe(true);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*UPDATE funcionalidades SET vendavel = false WHERE codigo = 'pcp'/);
    });
});
