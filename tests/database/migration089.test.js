const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { FUNCIONALIDADES, CODIGOS_FUNCIONALIDADES, RECURSOS } = require('../../src/constants/funcionalidades');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/089_funcionalidades.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');
const INTRODUZIDAS_DEPOIS_DA_089 = ['loja_online', 'fiado', 'importacao_lista'];

describe('migration 089 — arquivo', () => {
    test('está no runner', async () => {
        const versoes = (await listarMigrations()).map((m) => m.versao);

        expect(versoes).toContain(89);
    });

    test('é aditiva e idempotente: sem DROP/DELETE/UPDATE/ALTER e sem mexer em schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL.match(/CREATE TABLE/g)).toHaveLength(3);
        expect(EXECUTAVEL.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(3);
        expect(EXECUTAVEL.match(/ON CONFLICT/g)).toHaveLength(2);
    });

    test('o seed do catálogo coincide com src/constants/funcionalidades.js', () => {
        const bloco = EXECUTAVEL.match(/INSERT INTO funcionalidades[^;]*VALUES([^;]*)ON CONFLICT/s)[1];
        const linhas = [...bloco.matchAll(/\('([a-z_]+)',\s*'([^']*)',\s*'(recurso|modulo)',\s*(true|false)\)/g)]
            .map((m) => ({ codigo: m[1], nome: m[2], tipo: m[3], vendavel: m[4] === 'true' }));

        // Códigos criados por migrations posteriores (ex.: 095) não fazem parte do seed da 089.
        // `vendavel` de códigos alterados por migrations posteriores volta ao valor do seed original
        // (ex.: a 121 passou o `pcp` a vendável; o seed da 089 continua dizendo false, e migration aplicada não se edita).
        const VENDAVEL_NO_SEED_089 = { pcp: false };
        const daMigration089 = FUNCIONALIDADES
            .filter((f) => !INTRODUZIDAS_DEPOIS_DA_089.includes(f.codigo))
            .map((f) => (f.codigo in VENDAVEL_NO_SEED_089 ? { ...f, vendavel: VENDAVEL_NO_SEED_089[f.codigo] } : f));

        expect(linhas).toEqual(daMigration089.map(({ codigo, nome, tipo, vendavel }) => ({ codigo, nome, tipo, vendavel })));
        expect(new Set(CODIGOS_FUNCIONALIDADES).size).toBe(CODIGOS_FUNCIONALIDADES.length);
    });

    test('só os recursos entram nos planos legados, Padrão e Pro; Básico e Cortesia ficam de fora', () => {
        expect(EXECUTAVEL).toMatch(/p\.codigo IN \('sem_mensalidade', 'com_mensalidade', 'padrao', 'pro'\)/);
        expect(EXECUTAVEL).toMatch(/f\.tipo = 'recurso'/);
        expect(EXECUTAVEL).not.toMatch(/'basico'|'cortesia'/);
        expect(RECURSOS).toEqual(['comissoes', 'maletas', 'bancos', 'analise_financeira']);
    });

    test('tenant, unicidade e rastreabilidade obrigatórias nas ligações por empresa', () => {
        expect(EXECUTAVEL).toMatch(/empresa_id INTEGER NOT NULL REFERENCES empresas\(id\)/);
        expect(EXECUTAVEL).toMatch(/UNIQUE \(empresa_id, funcionalidade\)/);
        expect(EXECUTAVEL).toMatch(/btrim\(justificativa\) <> ''/);
        expect(EXECUTAVEL).toMatch(/btrim\(responsavel\) <> ''/);
        expect(EXECUTAVEL).toMatch(/vigencia_fim >= vigencia_inicio/);
    });
});
