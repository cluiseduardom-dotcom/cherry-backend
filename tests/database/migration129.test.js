const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/129_cnpj_alfanumerico_loja.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 129 — CNPJ alfanumérico na loja institucional', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(129);
    });

    test('só troca a constraint de formato (idempotente), sem tocar em dado', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|INSERT)\b/i);
        expect(EXECUTAVEL).toMatch(/DROP CONSTRAINT IF EXISTS loja_institucional_cnpj_chk/);
        expect(EXECUTAVEL).toMatch(/\^\[0-9A-Z\]\{12\}\[0-9\]\{2\}\$/);
    });

    test('o formato aceita os numéricos de antes e recusa minúscula, tamanho errado e letra nos dígitos verificadores', () => {
        const formato = /^[0-9A-Z]{12}[0-9]{2}$/;

        for (const ok of ['11222333000181', '12ABC34501DE35']) expect(formato.test(ok)).toBe(true);
        for (const ruim of ['12abc34501de35', '12ABC34501DE3', '12ABC34501DEAB', '']) expect(formato.test(ruim)).toBe(false);
    });
});
