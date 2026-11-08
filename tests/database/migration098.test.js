const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/098_loja_entrega_combinada.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 098 — entrega combinada', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(98);
    });

    test('só acrescenta colunas opcionais, regras novas e um índice: nada é removido, reescrito nem apagado', () => {
        expect(EXECUTAVEL).toMatch(/ADD COLUMN IF NOT EXISTS entrega_combinada_em TIMESTAMPTZ,/);
        expect(EXECUTAVEL).not.toMatch(/NOT NULL/i);
        expect(EXECUTAVEL).not.toMatch(/DROP |TRUNCATE|SET NOT NULL|ALTER COLUMN/i);
        expect(EXECUTAVEL).not.toMatch(/^\s*(DELETE\s+FROM|UPDATE\s+\w+\s+SET)/im);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('só pedido pago pode ter entrega combinada, o usuário é da mesma empresa e o índice cobre só o que espera contato', () => {
        expect(EXECUTAVEL).toMatch(/CHECK \(entrega_combinada_em IS NULL OR status = 'pago'\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(entrega_combinada_por, empresa_id\) REFERENCES usuarios \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/CREATE INDEX IF NOT EXISTS idx_pedidos_loja_a_combinar[\s\S]*WHERE status = 'pago' AND entrega_combinada_em IS NULL/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP COLUMN IF EXISTS entrega_combinada_em/);
    });
});
