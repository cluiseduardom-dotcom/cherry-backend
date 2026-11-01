const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { TEMAS_VISUAIS, SLUG_REGEX } = require('../../src/constants/temasVisuais');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/081_empresas_slug_identidade.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 081 — arquivo', () => {
    test('está na sequência do runner, depois da 080', async () => {
        const versoes = (await listarMigrations()).map((m) => m.versao);

        expect(versoes).toContain(81);
        expect(versoes.indexOf(81)).toBe(versoes.indexOf(80) + 1);
    });

    test('não apaga dado: sem DELETE/TRUNCATE e sem tocar em schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE|TRUNCATE)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('o único UPDATE é restrito à Cherry Semijoias e não sobrescreve slug nem colide', () => {
        const updates = EXECUTAVEL.match(/UPDATE[\s\S]*?;/gi) || [];

        expect(updates).toHaveLength(1);
        expect(updates[0]).toMatch(/WHERE nome = 'Cherry Semijoias' AND slug IS NULL/);
        expect(updates[0]).toMatch(/NOT EXISTS/);
    });

    test('o CHECK do tema acompanha o conjunto fechado do código', () => {
        const lista = EXECUTAVEL.match(/CHECK \(tema_visual IN \(([^)]*)\)\)/)[1];

        expect(lista.split(',').map((v) => v.trim().replace(/'/g, ''))).toEqual(TEMAS_VISUAIS);
    });

    test('o CHECK do slug no banco é o mesmo regex do código', () => {
        const regexSql = EXECUTAVEL.match(/slug ~ '([^']+)'/)[1];

        expect(regexSql).toBe(SLUG_REGEX.source);
    });

    test('a checagem de idempotência das constraints é escopada à tabela empresas', () => {
        expect(EXECUTAVEL).toMatch(/conname = 'empresas_slug_chk' AND conrelid = 'empresas'::regclass/);
    });
});
