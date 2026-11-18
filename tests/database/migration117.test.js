const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { FUNCIONALIDADES } = require('../../src/constants/funcionalidades');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/117_importacao_lista.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 117 — importação de lista', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(117);
    });

    test('só acrescenta e é idempotente: sem DELETE/UPDATE/TRUNCATE/DROP, só ALTER ... ADD COLUMN IF NOT EXISTS', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+\w+\s+SET|DROP)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL.match(/ALTER TABLE/g)).toHaveLength(1);
        expect(EXECUTAVEL).toMatch(/ALTER TABLE empresas ADD COLUMN IF NOT EXISTS estoque_inicial_lancado_em TIMESTAMPTZ;/);
        expect(EXECUTAVEL.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
        expect(EXECUTAVEL.match(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)).toBeNull();
        expect(EXECUTAVEL).toMatch(/ON CONFLICT \(codigo\) DO NOTHING/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP TABLE IF EXISTS importacoes_previas/);
        expect(SQL).toMatch(/DROP COLUMN IF EXISTS estoque_inicial_lancado_em/);
        expect(SQL).toMatch(/DELETE FROM funcionalidades WHERE codigo = 'importacao_lista'/);
    });

    test('a funcionalidade nasce desligada (nenhum plano a inclui) e o seed coincide com a constante', () => {
        expect(EXECUTAVEL).not.toMatch(/plano_funcionalidades/i);

        const m = EXECUTAVEL.match(/\('importacao_lista',\s*'([^']*)',\s*'(recurso|modulo)',\s*(true|false)\)/);
        const constante = FUNCIONALIDADES.find((f) => f.codigo === 'importacao_lista');

        expect({ nome: m[1], tipo: m[2], vendavel: m[3] === 'true' }).toEqual({ nome: constante.nome, tipo: constante.tipo, vendavel: constante.vendavel });
    });

    test('isolamento e integridade: empresa_id em tudo, FK composta com usuário/local/importação, hash e status checados', () => {
        expect(EXECUTAVEL.match(/empresa_id INTEGER NOT NULL REFERENCES empresas\(id\)/g)).toHaveLength(2);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(usuario_id, empresa_id\) REFERENCES usuarios \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(local_padrao_id, empresa_id\) REFERENCES locais_estoque \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(importacao_id, empresa_id\)\s+REFERENCES importacoes \(id, empresa_id\) ON DELETE CASCADE/);
        expect(EXECUTAVEL).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_importacoes_id_empresa ON importacoes \(id, empresa_id\)/);
        expect(EXECUTAVEL).toMatch(/hash_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
        expect(EXECUTAVEL).toMatch(/status IN \('previa', 'confirmada', 'expirada'\)/);
        expect(EXECUTAVEL).toMatch(/tipo IN \('produtos', 'clientes'\)/);
        expect(EXECUTAVEL).toMatch(/UNIQUE \(token_hash\)/);
    });

    test('a trilha não guarda dado pessoal: o conteúdo só existe na tabela de prévias', () => {
        const trilha = EXECUTAVEL.match(/CREATE TABLE IF NOT EXISTS importacoes \(([\s\S]*?)\n\);/)[1];
        expect(trilha).not.toMatch(/JSONB|telefone|nome\s+VARCHAR|dados/i);
        expect(EXECUTAVEL).toMatch(/importacoes_previas[\s\S]*dados JSONB NOT NULL/);
    });
});
