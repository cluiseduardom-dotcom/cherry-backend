const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/096_loja_pedidos_reserva.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 096 — reserva de estoque e pedidos da loja', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(96);
    });

    test('única mudança em estrutura existente: as duas constraints de locais_estoque, e só para ACEITAR o tipo novo', () => {
        const alteracoes = EXECUTAVEL.match(/ALTER TABLE \w+/g);

        expect(alteracoes).toEqual(['ALTER TABLE locais_estoque', 'ALTER TABLE locais_estoque', 'ALTER TABLE locais_estoque', 'ALTER TABLE locais_estoque']);
        expect(EXECUTAVEL).toMatch(/DROP CONSTRAINT IF EXISTS locais_estoque_tipo_chk/);
        expect(EXECUTAVEL).toMatch(/DROP CONSTRAINT IF EXISTS locais_estoque_dono_chk/);
        expect(EXECUTAVEL).toMatch(/tipo IN \('central', 'maleta', 'consignado', 'transito', 'reserva'\)/);
        expect(EXECUTAVEL).toMatch(/tipo IN \('central', 'transito', 'reserva'\) AND usuario_id IS NULL AND cliente_id IS NULL/);
    });

    test('nenhum dado é apagado ou reescrito: sem DELETE, UPDATE, TRUNCATE nem DROP TABLE, nem toca schema_migrations', () => {
        // Comandos que apagam ou reescrevem linhas (a palavra UPDATE/DELETE do gatilho de imutabilidade é proteção, não comando).
        expect(EXECUTAVEL).not.toMatch(/^\s*(DELETE\s+FROM|UPDATE\s+\w+\s+SET|TRUNCATE)\b/im);
        expect(EXECUTAVEL).not.toMatch(/DROP TABLE/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('o tipo cabe na coluna (VARCHAR(12)): a coluna não é alterada', () => {
        expect('reserva'.length).toBeLessThanOrEqual(12);
        expect(EXECUTAVEL).not.toMatch(/ALTER COLUMN/i);
    });

    test('cria as tabelas sempre com IF NOT EXISTS, empresa_id e FK composta', () => {
        expect(EXECUTAVEL.match(/CREATE TABLE/g)).toHaveLength(3);
        expect(EXECUTAVEL.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(3);
        expect(EXECUTAVEL.match(/empresa_id INTEGER NOT NULL REFERENCES empresas\(id\)/g)).toHaveLength(3);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(pedido_id, empresa_id\) REFERENCES pedidos_loja \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(produto_id, empresa_id\) REFERENCES produtos \(id, empresa_id\)/);
    });

    test('idempotência por empresa, uma única Reserva por empresa e trilha imutável', () => {
        expect(EXECUTAVEL).toMatch(/UNIQUE \(empresa_id, chave_idempotencia\)/);
        expect(EXECUTAVEL).toMatch(/uq_locais_estoque_reserva ON locais_estoque \(empresa_id\) WHERE tipo = 'reserva'/);
        expect(EXECUTAVEL).toMatch(/BEFORE UPDATE OR DELETE ON pedidos_loja_eventos/);
        expect(EXECUTAVEL).toMatch(/vertumno\.limpeza_teste/);
    });

    test('o pedido nasce consistente: total = subtotal - desconto + frete e estados fechados', () => {
        expect(EXECUTAVEL).toMatch(/total = subtotal - desconto \+ COALESCE\(frete, 0\)/);
        expect(EXECUTAVEL).toMatch(/status IN \('aguardando_pagamento', 'pago', 'cancelado', 'expirado'\)/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP TABLE IF EXISTS pedidos_loja_eventos/);
        expect(SQL).toMatch(/locais_estoque_tipo_chk CHECK \(tipo IN \('central', 'maleta', 'consignado', 'transito'\)\)/);
    });

    test('não guarda custo, margem nem dado de pagamento por cartão', () => {
        expect(EXECUTAVEL).not.toMatch(/custo|margem|cartao|card_number|cvv/i);
    });
});
