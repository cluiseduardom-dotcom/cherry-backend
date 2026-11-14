const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { FUNCIONALIDADES } = require('../../src/constants/funcionalidades');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/109_fiado.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 109 — fiado', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(109);
    });

    test('é só aditiva e idempotente: sem DELETE/UPDATE/ALTER/TRUNCATE/DROP TABLE e sem schema_migrations', () => {
        // O gatilho de imutabilidade cita UPDATE/DELETE de propósito; o que não pode existir é comando que altere dado ou tabela.
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+\w+\s+SET|ALTER\s+TABLE)\b/i);
        expect(EXECUTAVEL).not.toMatch(/DROP TABLE/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
        expect(EXECUTAVEL).toMatch(/ON CONFLICT \(codigo\) DO NOTHING/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP TABLE IF EXISTS fiado_lancamentos/);
        expect(SQL).toMatch(/DELETE FROM funcionalidades WHERE codigo = 'fiado'/);
    });

    test('a funcionalidade nasce desligada: nenhum plano a inclui; o seed coincide com a constante', () => {
        expect(EXECUTAVEL).not.toMatch(/plano_funcionalidades/i);

        const m = EXECUTAVEL.match(/\('fiado',\s*'([^']*)',\s*'(recurso|modulo)',\s*(true|false)\)/);
        const constante = FUNCIONALIDADES.find((f) => f.codigo === 'fiado');

        expect({ nome: m[1], tipo: m[2], vendavel: m[3] === 'true' }).toEqual({ nome: constante.nome, tipo: constante.tipo, vendavel: constante.vendavel });
    });

    test('integridade: NUMERIC, saldo não negativo, FK composta com cliente e usuário, estorno único, chave única por empresa, imutável', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(FLOAT|DOUBLE|REAL)\b/i);
        expect(EXECUTAVEL).toMatch(/saldo\s+NUMERIC\(12, 2\)/);
        expect(EXECUTAVEL).toMatch(/CHECK \(saldo >= 0\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(cliente_id, empresa_id\) REFERENCES clientes \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(criado_por, empresa_id\) REFERENCES usuarios \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_fiado_lancamentos_estorna/);
        expect(EXECUTAVEL).toMatch(/UNIQUE \(empresa_id, chave_idempotencia\)/);
        expect(EXECUTAVEL).toMatch(/BEFORE UPDATE OR DELETE ON fiado_lancamentos/);
    });
});
