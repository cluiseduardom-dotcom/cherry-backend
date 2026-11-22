const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { TEMAS_VISUAIS } = require('../../src/constants/temasVisuais');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/130_tema_visual_emilly.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 130 — tema visual emilly (demonstração)', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(130);
    });

    test('só troca a constraint (idempotente), sem tocar em dado', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|INSERT)\b/i);
        expect(EXECUTAVEL).toMatch(/DROP CONSTRAINT IF EXISTS empresas_tema_visual_chk/);
    });

    test('a lista do CHECK é exatamente o conjunto fechado do código (inclui emilly)', () => {
        const lista = EXECUTAVEL.match(/CHECK \(tema_visual IN \(([^)]*)\)\)/)[1].split(',').map((v) => v.trim().replace(/'/g, ''));

        expect(lista).toEqual([...TEMAS_VISUAIS]);
        expect(lista).toContain('emilly');
    });
});
