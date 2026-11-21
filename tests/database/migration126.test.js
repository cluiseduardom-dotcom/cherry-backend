const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');
const { FUNCIONALIDADES } = require('../../src/constants/funcionalidades');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/126_fiscal_preparo.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 126 — preparo fiscal', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(126);
    });

    test('só acrescenta e é idempotente: sem DROP/DELETE/TRUNCATE/UPDATE; insere a funcionalidade nova com ON CONFLICT', () => {
        expect(EXECUTAVEL).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
        expect(EXECUTAVEL).not.toMatch(/schema_migrations/i);
        expect(EXECUTAVEL).toMatch(/INSERT INTO funcionalidades \(codigo, nome, tipo, vendavel\) VALUES\s+\('fiscal_cadastro', '([^']*)', 'modulo', true\)\s+ON CONFLICT \(codigo\) DO NOTHING/);
        expect(EXECUTAVEL).toMatch(/CREATE TABLE IF NOT EXISTS empresa_fiscal/);
        expect(EXECUTAVEL.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(4);
    });

    test('todo campo fiscal é opcional: produto e empresa existentes não mudam', () => {
        for (const coluna of ['ncm', 'cest', 'origem_mercadoria', 'unidade_fiscal']) {
            expect(EXECUTAVEL).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${coluna} [A-Z0-9()]+\\s+CONSTRAINT`));
            expect(EXECUTAVEL).not.toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${coluna} [A-Z0-9()]+ NOT NULL`));
        }
    });

    test('formato garantido no banco: NCM 8 dígitos, CEST 7, origem 0 a 8, unidade em maiúsculas, IBGE 7, CNAE 7, regime e ambiente fechados', () => {
        expect(EXECUTAVEL).toMatch(/ncm ~ '\^\[0-9\]\{8\}\$'/);
        expect(EXECUTAVEL).toMatch(/cest ~ '\^\[0-9\]\{7\}\$'/);
        expect(EXECUTAVEL).toMatch(/origem_mercadoria BETWEEN 0 AND 8/);
        expect(EXECUTAVEL).toMatch(/unidade_fiscal ~ '\^\[A-Z\]\{1,6\}\$'/);
        expect(EXECUTAVEL).toMatch(/codigo_municipio_ibge ~ '\^\[0-9\]\{7\}\$'/);
        expect(EXECUTAVEL).toMatch(/cnae_principal ~ '\^\[0-9\]\{7\}\$'/);
        expect(EXECUTAVEL).toMatch(/regime_tributario IN \('mei', 'simples_nacional', 'simples_nacional_excesso', 'lucro_presumido', 'lucro_real'\)/);
        expect(EXECUTAVEL).toMatch(/ambiente IN \('homologacao', 'producao'\)/);
    });

    test('isolamento: uma linha por empresa (PK) e FK composta do usuário; nada de segredo nem regra tributária', () => {
        expect(EXECUTAVEL).toMatch(/empresa_id\s+INTEGER\s+PRIMARY KEY REFERENCES empresas \(id\)/);
        expect(EXECUTAVEL).toMatch(/FOREIGN KEY \(atualizado_por, empresa_id\) REFERENCES usuarios \(id, empresa_id\)/);
        expect(EXECUTAVEL).not.toMatch(/certificado|senha|csc|token|cst|csosn|aliquota|ibs|cbs/i);
    });

    test('nenhum plano inclui o cadastro fiscal; o seed coincide com a constante; o módulo `fiscal` (emissão) segue "em breve"', () => {
        expect(EXECUTAVEL).not.toMatch(/plano_funcionalidades|empresa_funcionalidades/i);

        const m = EXECUTAVEL.match(/\('fiscal_cadastro', '([^']*)', '(recurso|modulo)', (true|false)\)/);
        const constante = FUNCIONALIDADES.find((f) => f.codigo === 'fiscal_cadastro');

        expect({ nome: m[1], tipo: m[2], vendavel: m[3] === 'true' }).toEqual({ nome: constante.nome, tipo: constante.tipo, vendavel: constante.vendavel });
        expect(FUNCIONALIDADES.find((f) => f.codigo === 'fiscal').vendavel).toBe(false);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*DROP TABLE IF EXISTS empresa_fiscal/);
        expect(SQL).toMatch(/DELETE FROM funcionalidades WHERE codigo = 'fiscal_cadastro'/);
    });
});
