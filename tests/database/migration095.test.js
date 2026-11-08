const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { FUNCIONALIDADES } = require('../../src/constants/funcionalidades');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/095_loja_online.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 095 — loja online', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(95);
    });

    test('é só aditiva e idempotente: nada de DROP/DELETE/UPDATE/ALTER/TRUNCATE nem schema_migrations', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL.match(/CREATE TABLE/g)).toHaveLength(1);
        expect(EXECUTAVEL).toMatch(/CREATE TABLE IF NOT EXISTS produtos_loja/);
        expect(EXECUTAVEL).toMatch(/CREATE INDEX IF NOT EXISTS/);
        expect(EXECUTAVEL).toMatch(/ON CONFLICT \(codigo\) DO NOTHING/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP TABLE IF EXISTS produtos_loja/);
        expect(SQL).toMatch(/DELETE FROM funcionalidades WHERE codigo = 'loja_online'/);
    });

    test('a funcionalidade nasce desligada: nenhum plano a inclui', () => {
        expect(EXECUTAVEL).not.toMatch(/plano_funcionalidades/i);
    });

    test('o seed coincide com src/constants/funcionalidades.js', () => {
        const m = EXECUTAVEL.match(/\('loja_online',\s*'([^']*)',\s*'(recurso|modulo)',\s*(true|false)\)/);
        const constante = FUNCIONALIDADES.find((f) => f.codigo === 'loja_online');

        expect({ nome: m[1], tipo: m[2], vendavel: m[3] === 'true' }).toEqual({ nome: constante.nome, tipo: constante.tipo, vendavel: constante.vendavel });
    });

    test('tenant e integridade: empresa_id, FK composta com o produto, slug único por empresa e visível por padrão falso', () => {
        expect(EXECUTAVEL).toMatch(/empresa_id INTEGER NOT NULL REFERENCES empresas\(id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(produto_id, empresa_id\) REFERENCES produtos \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/UNIQUE \(empresa_id, slug\)/);
        expect(EXECUTAVEL).toMatch(/visivel BOOLEAN NOT NULL DEFAULT false/);
    });

    test('não cria preço, estoque nem custo: a tabela não é segunda fonte de verdade', () => {
        const tabela = EXECUTAVEL.match(/CREATE TABLE IF NOT EXISTS produtos_loja \(([\s\S]*?)\n\);/)[1];

        expect(tabela).not.toMatch(/preco|estoque|saldo|custo|margem/i);
    });
});
