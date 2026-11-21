const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/123_ordem_producao_consumos.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 123 — consumo de insumos da ordem de produção (pendência de baixa)', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(123);
    });

    test('só acrescenta e é idempotente: uma tabela, sem DROP/DELETE/UPDATE/ALTER', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL.match(/CREATE TABLE IF NOT EXISTS ordem_producao_consumos/g)).toHaveLength(1);
        expect(EXECUTAVEL.match(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)).toBeNull();
    });

    test('isolamento por empresa: empresa_id obrigatório e FKs compostas (ordem, insumo, local)', () => {
        expect(EXECUTAVEL).toMatch(/empresa_id\s+INTEGER\s+NOT NULL REFERENCES empresas \(id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(ordem_id, empresa_id\) REFERENCES ordens_producao \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(insumo_produto_id, empresa_id\) REFERENCES produtos \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(local_id, empresa_id\) REFERENCES locais_estoque \(id, empresa_id\)/);
    });

    test('integridade: baixado nunca passa do previsto (estoque não fica negativo por aqui) e um consumo por insumo', () => {
        expect(EXECUTAVEL).toMatch(/quantidade_prevista > 0 AND quantidade_baixada >= 0 AND quantidade_baixada <= quantidade_prevista/);
        expect(EXECUTAVEL).toMatch(/UNIQUE \(ordem_id, insumo_produto_id\)/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP TABLE IF EXISTS ordem_producao_consumos/);
    });
});
