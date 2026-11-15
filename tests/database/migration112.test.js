const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/112_pix_destino_cobranca.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 112 — destino do Pix (fiado e parcela)', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(112);
    });

    test('é só aditiva e idempotente: sem DELETE/UPDATE/DROP/TRUNCATE e sem schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|DROP)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);

        for (const coluna of ['destino_tipo', 'destino_id', 'destino_aplicado_em', 'destino_erro']) {
            expect(EXECUTAVEL).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${coluna}`));
        }
    });

    test('lista fechada de destinos e destino nunca convive com venda', () => {
        expect(EXECUTAVEL).toMatch(/destino_tipo IN \('fiado', 'conta_receber'\)/);
        expect(EXECUTAVEL).toMatch(/destino_id IS NOT NULL AND venda_id IS NULL/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP CONSTRAINT IF EXISTS ck_cobranca_destino/);
    });
});
