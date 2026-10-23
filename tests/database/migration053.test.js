const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { MODULOS } = require('../../src/constants/modulos');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/053_empresa_modulos.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 053 — arquivo', () => {
    test('está no runner', async () => {
        const versoes = (await listarMigrations()).map((m) => m.versao);

        expect(versoes).toContain(53);
    });

    test('é aditiva e idempotente: só CREATE TABLE IF NOT EXISTS', () => {
        expect(EXECUTAVEL).toMatch(/CREATE TABLE IF NOT EXISTS empresa_modulos/);
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|UPDATE|ALTER)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('o CHECK do banco acompanha o catálogo do código', () => {
        const lista = EXECUTAVEL.match(/CHECK \(modulo IN \(([^)]*)\)\)/)[1];
        const valores = lista.split(',').map((v) => v.trim().replace(/'/g, ''));

        expect(valores).toEqual(MODULOS);
    });

    test('tenant, unicidade e rastreabilidade obrigatórias', () => {
        expect(EXECUTAVEL).toMatch(/empresa_id INTEGER NOT NULL REFERENCES empresas\(id\)/);
        expect(EXECUTAVEL).toMatch(/UNIQUE \(empresa_id, modulo\)/);
        expect(EXECUTAVEL).toMatch(/btrim\(justificativa\) <> ''/);
        expect(EXECUTAVEL).toMatch(/btrim\(responsavel\) <> ''/);
    });
});
