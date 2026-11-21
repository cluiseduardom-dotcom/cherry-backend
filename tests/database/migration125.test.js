const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { FUNCIONALIDADES } = require('../../src/constants/funcionalidades');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/125_grade_produtos.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 125 — grade de produtos', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(125);
    });

    test('só acrescenta e é idempotente: sem DROP/DELETE/TRUNCATE; um único UPDATE (o flag da funcionalidade)', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL.match(/\bUPDATE\b/gi)).toHaveLength(1);
        expect(EXECUTAVEL).toMatch(/UPDATE funcionalidades SET vendavel = true WHERE codigo = 'grade'/);
        expect(EXECUTAVEL).toMatch(/CREATE TABLE IF NOT EXISTS grades_produto/);
        expect(EXECUTAVEL).toMatch(/ADD COLUMN IF NOT EXISTS grade_id/);
        expect(EXECUTAVEL).toMatch(/ADD COLUMN IF NOT EXISTS variacao/);
        expect(EXECUTAVEL.match(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)).toBeNull();
    });

    test('isolamento e integridade: empresa_id obrigatório, FKs compostas, variação coerente com a grade e sem repetição', () => {
        expect(EXECUTAVEL).toMatch(/empresa_id\s+INTEGER\s+NOT NULL REFERENCES empresas \(id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(grade_id, empresa_id\) REFERENCES grades_produto \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(criado_por, empresa_id\) REFERENCES usuarios \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/grade_id IS NULL AND variacao IS NULL/);
        expect(EXECUTAVEL).toMatch(/ON produtos \(grade_id, variacao\) WHERE grade_id IS NOT NULL/);
        expect(EXECUTAVEL).toMatch(/jsonb_array_length\(eixos\) BETWEEN 1 AND 3/);
    });

    test('nenhum plano passa a incluir a grade; a constante do catálogo coincide', () => {
        expect(EXECUTAVEL).not.toMatch(/plano_funcionalidades|empresa_funcionalidades/i);
        expect(FUNCIONALIDADES.find((f) => f.codigo === 'grade').vendavel).toBe(true);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP TABLE IF EXISTS grades_produto/);
    });
});
