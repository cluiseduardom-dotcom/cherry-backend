const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/114_periodos_lancamentos_taxa.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 114 — períodos e lançamentos da taxa da plataforma', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(114);
    });

    test('é aditiva e idempotente: sem DELETE/UPDATE/TRUNCATE de dados e sem schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+\w+\s+SET|DROP\s+TABLE|DROP\s+COLUMN)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL).toMatch(/CREATE TABLE IF NOT EXISTS periodos_taxa/);
        expect(EXECUTAVEL).toMatch(/CREATE TABLE IF NOT EXISTS lancamentos_taxa/);
    });

    test('valores em NUMERIC com 2 casas e empresa_id nas duas tabelas', () => {
        expect(EXECUTAVEL).toMatch(/total_calculado NUMERIC\(15,2\)/);
        expect(EXECUTAVEL).toMatch(/total_retido_mp NUMERIC\(15,2\)/);
        expect(EXECUTAVEL).toMatch(/valor NUMERIC\(15,2\) NOT NULL/);
        expect(EXECUTAVEL.match(/empresa_id INTEGER NOT NULL REFERENCES empresas \(id\)/g)).toHaveLength(2);
    });

    test('referências compostas por empresa (período e venda)', () => {
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(periodo_id, empresa_id\)\s+REFERENCES periodos_taxa \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(venda_id, empresa_id\)\s+REFERENCES vendas \(id, empresa_id\)/);
    });

    test('lista fechada de status e de tipos', () => {
        expect(EXECUTAVEL).toMatch(/status IN \('aberto', 'fechado', 'parcialmente_pago', 'pago'\)/);
        expect(EXECUTAVEL).toMatch(/tipo IN \('pagamento', 'ajuste', 'perdao', 'estorno_venda'\)/);
    });

    test('lançamentos só-inserção e período protegido por gatilho', () => {
        expect(EXECUTAVEL).toMatch(/BEFORE UPDATE OR DELETE ON lancamentos_taxa/);
        expect(EXECUTAVEL).toMatch(/BEFORE UPDATE OR DELETE ON periodos_taxa/);
        expect(EXECUTAVEL).toMatch(/BEFORE INSERT ON lancamentos_taxa/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP TABLE IF EXISTS lancamentos_taxa;[\s\S]*DROP TABLE IF EXISTS periodos_taxa;/);
    });
});
