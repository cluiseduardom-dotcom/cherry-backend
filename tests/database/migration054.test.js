const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { ORIGENS_AQUISICAO, PARCEIRO_CODIGO_REGEX } = require('../../src/constants/origensAquisicao');

const ARQUIVO = path.join(__dirname, '../../src/database/migrations/054_empresas_origem_aquisicao.sql');
const SQL = fs.readFileSync(ARQUIVO, 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 054 — arquivo', () => {
    test('está no runner, depois da 053', async () => {
        const versoes = (await listarMigrations()).map((m) => m.versao);

        expect(versoes).toContain(54);
        expect(versoes.indexOf(54)).toBeGreaterThan(versoes.indexOf(53));
    });

    test('é aditiva: sem DROP/DELETE/TRUNCATE/INSERT/UPDATE e sem tocar em schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|UPDATE)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('colunas idempotentes, com padrão que mantém toda empresa existente válida', () => {
        expect(EXECUTAVEL).toMatch(/ADD COLUMN IF NOT EXISTS origem_aquisicao VARCHAR\(30\) NOT NULL DEFAULT 'direta'/);
        expect(EXECUTAVEL).toMatch(/ADD COLUMN IF NOT EXISTS parceiro_codigo VARCHAR\(40\)/);
    });

    test('as checagens de idempotência das constraints são escopadas à tabela empresas', () => {
        const escopos = EXECUTAVEL.match(/conrelid = 'empresas'::regclass/g) || [];

        expect(escopos).toHaveLength(3);
    });

    test('o CHECK do banco acompanha o conjunto fechado do código', () => {
        const lista = EXECUTAVEL.match(/CHECK \(origem_aquisicao IN \(([^)]*)\)\)/)[1];
        const valores = lista.split(',').map((v) => v.trim().replace(/'/g, ''));

        expect(valores).toEqual(ORIGENS_AQUISICAO);
    });

    test('parceiro é obrigatório se, e somente se, a origem for indicação de parceiro', () => {
        expect(EXECUTAVEL).toMatch(
            /CHECK \(\(origem_aquisicao = 'indicacao_parceiro'\) = \(parceiro_codigo IS NOT NULL\)\)/
        );
    });

    test('o formato do código no banco é o mesmo da validação do código', () => {
        const regexBanco = EXECUTAVEL.match(/parceiro_codigo ~ '([^']*)'/)[1];

        expect(regexBanco).toBe(PARCEIRO_CODIGO_REGEX.source);
    });
});
