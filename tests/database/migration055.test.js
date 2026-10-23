const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { MODULOS } = require('../../src/constants/modulos');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/055_empresa_modulos_historico.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 055 — arquivo', () => {
    test('está no runner, depois da 053', async () => {
        const versoes = (await listarMigrations()).map((m) => m.versao);

        expect(versoes).toContain(55);
        expect(versoes.indexOf(55)).toBeGreaterThan(versoes.indexOf(53));
    });

    test('aditiva e idempotente: sem DROP de dado, sem DELETE/TRUNCATE/UPDATE de linhas', () => {
        expect(EXECUTAVEL).toMatch(/CREATE TABLE IF NOT EXISTS empresa_modulos_historico/);
        expect(EXECUTAVEL).not.toMatch(/\b(TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET)\b/i);
        expect(EXECUTAVEL).not.toMatch(/DROP TABLE/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('o CHECK acompanha o catálogo do código', () => {
        const lista = EXECUTAVEL.match(/CHECK \(modulo IN \(([^)]*)\)\)/)[1];
        const valores = lista.split(',').map((v) => v.trim().replace(/'/g, ''));

        expect(valores).toEqual(MODULOS);
    });

    test('é imutável: gatilho recusa UPDATE e DELETE', () => {
        expect(EXECUTAVEL).toMatch(/BEFORE UPDATE OR DELETE ON empresa_modulos_historico/);
        expect(EXECUTAVEL).toMatch(/RAISE EXCEPTION/);
    });
});
