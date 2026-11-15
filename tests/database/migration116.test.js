const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/116_bloqueios_pix_empresa.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 116 — bloqueios de Pix por empresa', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(116);
    });

    test('aditiva e idempotente: sem DELETE/TRUNCATE de dados e sem schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+\w+\s+SET|DROP\s+TABLE|DROP\s+COLUMN)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL).toMatch(/CREATE TABLE IF NOT EXISTS bloqueios_pix_empresa/);
        expect(EXECUTAVEL).toMatch(/empresa_id INTEGER NOT NULL REFERENCES empresas \(id\)/);
    });

    test('motivos da SPEC §7, um bloqueio ativo por empresa e motivo, justificativa obrigatória', () => {
        expect(EXECUTAVEL).toMatch(/motivo IN \('suspensao_taxa', 'pix_manual_sinalizado'\)/);
        expect(EXECUTAVEL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_bloqueios_pix_ativo[\s\S]*\(empresa_id, motivo\) WHERE liberado_em IS NULL/);
        expect(EXECUTAVEL).toMatch(/length\(btrim\(justificativa_liberacao\)\) >= 5/);
    });

    test('histórico protegido por gatilho e reversão manual no rodapé', () => {
        expect(EXECUTAVEL).toMatch(/BEFORE UPDATE OR DELETE ON bloqueios_pix_empresa/);
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP TABLE IF EXISTS bloqueios_pix_empresa;/);
    });
});
