const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/124_fracionado_receita.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 124 — receita com rendimento e custo com mais casas', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(124);
    });

    test('só amplia: sem DROP/DELETE/UPDATE/TRUNCATE; coluna nova idempotente e com CHECK', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL).toMatch(/ADD COLUMN IF NOT EXISTS rendimento INTEGER NOT NULL DEFAULT 1/);
        expect(EXECUTAVEL).toMatch(/CHECK \(rendimento > 0 AND rendimento <= 1000000\)/);
    });

    test('o custo só ganha casas (NUMERIC(14, 6)): nenhuma coluna perde precisão', () => {
        const alteradas = [...EXECUTAVEL.matchAll(/ALTER TABLE (\w+) ALTER COLUMN (\w+) TYPE NUMERIC\((\d+), (\d+)\)/g)].map((m) => [m[1], m[2], Number(m[3]), Number(m[4])]);

        expect(alteradas.map((a) => `${a[0]}.${a[1]}`).sort()).toEqual([
            'consumos_avulsos.custo_unitario', 'itens_compra.custo_unitario', 'itens_venda.custo_unitario', 'produtos.custo', 'venda_consumos.custo_unitario'
        ]);
        for (const [, , precisao, escala] of alteradas) {
            expect(escala).toBeGreaterThanOrEqual(2);
            expect(precisao - escala).toBeGreaterThanOrEqual(8); // mesmo teto de parte inteira de NUMERIC(10,2) ou maior
        }
    });

    test('o preço de venda não é tocado', () => {
        expect(EXECUTAVEL).not.toMatch(/preco_venda|preco_unitario/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP COLUMN IF EXISTS rendimento/);
    });
});
