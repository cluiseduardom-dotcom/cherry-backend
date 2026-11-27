const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/134_caixa_idempotencia_operador.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 134 — caixa: idempotência dos movimentos e uma sessão aberta por operador', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(134);
    });

    test('só acrescenta e é idempotente: sem DROP/DELETE/UPDATE/TRUNCATE; a única alteração é ADD COLUMN IF NOT EXISTS', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET)\b/i);
        expect(EXECUTAVEL).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i); // a coluna é opcional: a tabela pode já ter linhas
        expect(EXECUTAVEL.match(/ALTER TABLE/g)).toHaveLength(1);
        expect(EXECUTAVEL).toMatch(/ALTER TABLE caixa_movimentos ADD COLUMN IF NOT EXISTS chave_idempotencia VARCHAR\(80\)/);
        expect(EXECUTAVEL.match(/CREATE UNIQUE INDEX IF NOT EXISTS/g)).toHaveLength(2);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
    });

    test('os índices únicos são parciais: chave só quando preenchida, sessão só quando aberta', () => {
        expect(EXECUTAVEL).toMatch(/uq_caixa_movimentos_chave\s+ON caixa_movimentos \(empresa_id, chave_idempotencia\) WHERE chave_idempotencia IS NOT NULL/);
        expect(EXECUTAVEL).toMatch(/uq_caixa_sessoes_uma_aberta_por_operador\s+ON caixa_sessoes \(operador_id\) WHERE status = 'aberta'/);
    });
});
