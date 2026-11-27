const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { FUNCIONALIDADES } = require('../../src/constants/funcionalidades');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/133_caixa_pdv.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 133 — caixa por PDV (esquema)', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(133);
    });

    test('só acrescenta e é idempotente: sem DROP/DELETE/TRUNCATE/UPDATE/ALTER; nenhuma tabela existente é tocada', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP TABLE|TRUNCATE|ALTER TABLE|DELETE FROM|UPDATE\s+\w+\s+SET)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL.match(/CREATE TABLE/g)).toHaveLength(4);
        expect(EXECUTAVEL.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(4);
        expect(EXECUTAVEL).toMatch(/INSERT INTO funcionalidades \(codigo, nome, tipo, vendavel\) VALUES\s+\('caixa', '([^']*)', 'modulo', true\)\s+ON CONFLICT \(codigo\) DO NOTHING/);
        expect(EXECUTAVEL.match(/CREATE (OR REPLACE )?(FUNCTION|TRIGGER)|DROP TRIGGER IF EXISTS/g).length).toBeGreaterThan(0);
    });

    test('o nome da funcionalidade coincide com o catálogo em src/constants', () => {
        const nome = EXECUTAVEL.match(/\('caixa', '([^']*)', 'modulo', true\)/)[1];
        const doCatalogo = FUNCIONALIDADES.find((f) => f.codigo === 'caixa');

        expect(doCatalogo).toEqual({ codigo: 'caixa', tipo: 'modulo', nome, vendavel: true });
    });

    test('toda tabela é de tenant e toda referência a tabela de tenant é composta (id, empresa_id)', () => {
        expect(EXECUTAVEL.match(/empresa_id\s+INTEGER\s+NOT NULL REFERENCES empresas\(id\)/g)).toHaveLength(4);
        for (const fk of ['caixas_criado_por_fk', 'caixa_sessoes_caixa_fk', 'caixa_sessoes_operador_fk', 'caixa_sessoes_fechada_por_fk',
            'caixa_movimentos_sessao_fk', 'caixa_movimentos_usuario_fk', 'caixa_conferencias_sessao_fk']) {
            expect(EXECUTAVEL).toMatch(new RegExp(`CONSTRAINT ${fk} FOREIGN KEY \\(\\w+, empresa_id\\) REFERENCES \\w+ \\(id, empresa_id\\)`));
        }
    });

    test('regras no banco: uma sessão aberta por caixa, insere-só e sessão aberta exigida', () => {
        expect(EXECUTAVEL).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_caixa_sessoes_uma_aberta ON caixa_sessoes \(caixa_id\) WHERE status = 'aberta'/);
        expect(EXECUTAVEL).toMatch(/BEFORE UPDATE OR DELETE ON caixa_movimentos/);
        expect(EXECUTAVEL).toMatch(/BEFORE UPDATE OR DELETE ON caixa_conferencias/);
        expect(EXECUTAVEL).toMatch(/BEFORE UPDATE OR DELETE ON caixa_sessoes/);
        expect(EXECUTAVEL).toMatch(/FOR SHARE/);
        expect(EXECUTAVEL).toMatch(/vertumno\.limpeza_teste/);
    });
});
