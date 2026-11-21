const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/122_ordens_producao.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 122 — ordem de produção (PCP)', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(122);
    });

    test('só acrescenta e é idempotente: uma tabela, sem DROP/DELETE/UPDATE/ALTER, sem mexer em schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL.match(/CREATE TABLE IF NOT EXISTS ordens_producao/g)).toHaveLength(1);
        expect(EXECUTAVEL.match(/CREATE TABLE/g)).toHaveLength(1);
        expect(EXECUTAVEL.match(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)).toBeNull();
    });

    test('isolamento por empresa: empresa_id obrigatório e FK composta para produto e para cada usuário', () => {
        expect(EXECUTAVEL).toMatch(/empresa_id\s+INTEGER\s+NOT NULL REFERENCES empresas \(id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(produto_id, empresa_id\) REFERENCES produtos \(id, empresa_id\)/);

        for (const coluna of ['criado_por', 'iniciada_por', 'concluida_por', 'cancelada_por']) {
            expect(EXECUTAVEL).toMatch(new RegExp(`FOREIGN KEY \\(${coluna}, empresa_id\\) REFERENCES usuarios \\(id, empresa_id\\)`));
        }
    });

    test('integridade no banco: status fechado, quantidades não negativas e conclusão/cancelamento coerentes', () => {
        expect(EXECUTAVEL).toMatch(/status IN \('planejada', 'em_producao', 'concluida', 'cancelada'\)/);
        expect(EXECUTAVEL).toMatch(/quantidade_planejada > 0/);
        expect(EXECUTAVEL).toMatch(/quantidade_perdida >= 0/);
        expect(EXECUTAVEL).toMatch(/status <> 'concluida' OR \(quantidade_produzida IS NOT NULL AND concluida_em IS NOT NULL/);
        expect(EXECUTAVEL).toMatch(/status <> 'cancelada' OR cancelada_em IS NOT NULL/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP TABLE IF EXISTS ordens_producao/);
    });
});
