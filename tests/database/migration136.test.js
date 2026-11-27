const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/136_caixa_recebimentos.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 136 — caixa: recebimentos de parcela e fiado ligados à sessão', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(136);
    });

    test('só acrescenta e é idempotente: colunas opcionais, sem DROP de dado, sem DELETE/UPDATE/TRUNCATE', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET|DROP TABLE|DROP COLUMN)\b/i);
        expect(EXECUTAVEL).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL.match(/ADD COLUMN IF NOT EXISTS caixa_sessao_id INTEGER/g)).toHaveLength(2);
        expect(EXECUTAVEL.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(2);
    });

    test('referência composta NOT VALID + VALIDATE; gatilho só no INSERT, só com sessão, reaproveitando a função da 135', () => {
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(caixa_sessao_id, empresa_id\) REFERENCES caixa_sessoes \(id, empresa_id\) NOT VALID/);
        expect(EXECUTAVEL).toMatch(/VALIDATE CONSTRAINT/);
        expect(EXECUTAVEL.match(/BEFORE INSERT ON (recebimentos_conta|fiado_lancamentos)/g)).toHaveLength(2);
        expect(EXECUTAVEL.match(/WHEN \(NEW\.caixa_sessao_id IS NOT NULL\)/g)).toHaveLength(2);
        expect(EXECUTAVEL.match(/EXECUTE FUNCTION caixa_pagamento_exige_sessao_aberta\(\)/g)).toHaveLength(2);
        expect(EXECUTAVEL).not.toMatch(/BEFORE (UPDATE|DELETE)/i);
    });
});
