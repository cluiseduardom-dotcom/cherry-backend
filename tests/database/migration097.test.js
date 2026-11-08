const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/097_loja_pagamento.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 097 — pagamento da loja online', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(97);
    });

    test('só relaxa duas colunas e cria um índice: nada de DROP TABLE, DELETE, UPDATE, TRUNCATE nem schema_migrations', () => {
        expect(EXECUTAVEL.match(/ALTER TABLE \w+ ALTER COLUMN \w+ DROP NOT NULL/g)).toEqual([
            'ALTER TABLE cobrancas_pagamento ALTER COLUMN criado_por DROP NOT NULL',
            'ALTER TABLE pagamentos_venda ALTER COLUMN usuario_id DROP NOT NULL'
        ]);
        expect(EXECUTAVEL.match(/\bALTER TABLE\b/g)).toHaveLength(2);
        expect(EXECUTAVEL).not.toMatch(/DROP TABLE|DROP COLUMN|DROP CONSTRAINT|SET NOT NULL|\bTRUNCATE\b/i);
        expect(EXECUTAVEL).not.toMatch(/^\s*(DELETE\s+FROM|UPDATE\s+\w+\s+SET)/im);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('um pedido por cobrança, por empresa, e idempotente', () => {
        expect(EXECUTAVEL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_loja_cobranca\s+ON pedidos_loja \(empresa_id, cobranca_codigo\) WHERE cobranca_codigo IS NOT NULL/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*SET NOT NULL[\s\S]*SET NOT NULL/);
        expect(SQL).toMatch(/DROP INDEX IF EXISTS uq_pedidos_loja_cobranca/);
    });
});
