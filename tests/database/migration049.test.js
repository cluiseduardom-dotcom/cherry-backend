const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { TEMAS_VISUAIS } = require('../../src/constants/temasVisuais');

const ARQUIVO = path.join(__dirname, '../../src/database/migrations/049_empresas_tema_visual.sql');
const SQL = fs.readFileSync(ARQUIVO, 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 049 — arquivo', () => {
    test('está na sequência do runner, depois da 048', async () => {
        const versoes = (await listarMigrations()).map((m) => m.versao);

        expect(versoes).toContain(49);
        expect(versoes.indexOf(49)).toBe(versoes.indexOf(48) + 1);
    });

    test('é aditiva: sem DROP/DELETE/TRUNCATE/INSERT e sem tocar em schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('o único UPDATE é restrito à Cherry Semijoias', () => {
        const updates = EXECUTAVEL.match(/UPDATE[\s\S]*?;/gi) || [];

        expect(updates).toHaveLength(1);
        expect(updates[0]).toMatch(/WHERE nome = 'Cherry Semijoias'/);
    });

    test('a checagem de idempotência da constraint é escopada à tabela empresas (o nome é global no pg_constraint)', () => {
        expect(EXECUTAVEL).toMatch(/conname = 'empresas_tema_visual_chk' AND conrelid = 'empresas'::regclass/);
    });

    test('o CHECK original (049) cobre os dois primeiros temas; a 081 o amplia e o teste dela cobre o conjunto atual', () => {
        const lista = EXECUTAVEL.match(/CHECK \(tema_visual IN \(([^)]*)\)\)/)[1];
        const valores = lista.split(',').map((v) => v.trim().replace(/'/g, ''));

        expect(valores).toEqual(TEMAS_VISUAIS.slice(0, 2));
        expect(EXECUTAVEL).toMatch(/NOT NULL DEFAULT 'vertumno'/);
    });
});
