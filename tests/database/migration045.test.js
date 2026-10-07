const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { listarMigrations } = require('../../src/database/migrate');

const ARQUIVO = path.join(__dirname, '../../src/database/migrations/045_corrige_colunas_kit_id_unidade.sql');
const SQL = fs.readFileSync(ARQUIVO, 'utf8');

describe('migration 045 — arquivo', () => {
    test('está na sequência do runner, depois da 044', async () => {
        const versoes = (await listarMigrations()).map((m) => m.versao);

        expect(versoes).toContain(45);
        expect(versoes.indexOf(45)).toBe(versoes.indexOf(44) + 1);
    });

    test('é só aditiva: sem DROP/DELETE/UPDATE/INSERT/TRUNCATE e sem tocar em schema_migrations', () => {
        const executavel = SQL.replace(/--.*$/gm, '');

        expect(executavel).not.toMatch(/\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/i);
        expect(executavel).not.toMatch(/schema_migrations/i);
    });

    test('usa ADD COLUMN IF NOT EXISTS nas duas colunas, com as definições da 017 e 018', () => {
        expect(SQL).toMatch(/ALTER TABLE itens_venda ADD COLUMN IF NOT EXISTS kit_id INTEGER NULL;/);
        expect(SQL).toMatch(/ALTER TABLE produtos ADD COLUMN IF NOT EXISTS unidade VARCHAR\(4\) NOT NULL DEFAULT 'UN';/);
    });
});

// Banco real da CI/dev, mas SOMENTE num schema temporário próprio: nunca toca nas tabelas reais.
const describeComBanco = process.env.DATABASE_URL ? describe : describe.skip;

describeComBanco('migration 045 — comportamento em schema isolado', () => {
    const schema = `mig045_${crypto.randomBytes(4).toString('hex')}`;
    let client;

    const colunas = async (tabela) => (await client.query(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
         FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`, [schema, tabela]
    )).rows.reduce((acc, r) => ({ ...acc, [r.column_name]: r }), {});

    async function criarTabelas({ kitId = false, unidade = false } = {}) {
        await client.query(`DROP TABLE IF EXISTS itens_venda, produtos`);
        await client.query(`CREATE TABLE produtos (id SERIAL PRIMARY KEY, nome VARCHAR(50) NOT NULL${unidade ? `, unidade ${unidade}` : ''})`);
        await client.query(`CREATE TABLE itens_venda (id SERIAL PRIMARY KEY, venda_id INTEGER NOT NULL, quantidade INTEGER NOT NULL${kitId ? `, kit_id ${kitId}` : ''})`);
        await client.query(`INSERT INTO produtos (nome) VALUES ('A'), ('B'), ('C')`);
        await client.query(`INSERT INTO itens_venda (venda_id, quantidade) VALUES (1, 2), (1, 3), (2, 7)`);
    }

    const instantaneo = async () => (await client.query(
        `SELECT (SELECT md5(string_agg(p.id::text || p.nome, ',' ORDER BY p.id)) FROM produtos p) AS produtos,
                (SELECT md5(string_agg(i.id::text || ':' || i.venda_id || ':' || i.quantidade, ',' ORDER BY i.id)) FROM itens_venda i) AS itens`
    )).rows[0];

    beforeAll(async () => {
        client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`SET search_path TO ${schema}`);
    });

    afterAll(async () => {
        await client.query('SET search_path TO public');
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
    });

    test('colunas ausentes (drift do staging): cria com a definição exata, sem perder nem alterar dados', async () => {
        await criarTabelas();
        const antes = await instantaneo();

        await client.query(SQL);

        const itens = await colunas('itens_venda');
        const produtos = await colunas('produtos');
        expect(itens.kit_id).toMatchObject({ data_type: 'integer', is_nullable: 'YES', column_default: null });
        expect(produtos.unidade).toMatchObject({
            data_type: 'character varying', is_nullable: 'NO', character_maximum_length: 4
        });
        expect(produtos.unidade.column_default).toMatch(/^'UN'/);

        expect(await instantaneo()).toEqual(antes);
        expect((await client.query('SELECT count(*)::int AS n FROM produtos')).rows[0].n).toBe(3);
        expect((await client.query('SELECT count(*)::int AS n FROM itens_venda')).rows[0].n).toBe(3);
        expect((await client.query(`SELECT count(*)::int AS n FROM produtos WHERE unidade = 'UN'`)).rows[0].n).toBe(3);
        expect((await client.query('SELECT count(*)::int AS n FROM itens_venda WHERE kit_id IS NULL')).rows[0].n).toBe(3);
    });

    test('idempotente: rodar de novo (colunas já existem) não falha e não altera nada', async () => {
        await criarTabelas();
        await client.query(SQL);
        const antes = await instantaneo();
        const defsAntes = { itens: await colunas('itens_venda'), produtos: await colunas('produtos') };

        await client.query(SQL);
        await client.query(SQL);

        expect(await instantaneo()).toEqual(antes);
        expect({ itens: await colunas('itens_venda'), produtos: await colunas('produtos') }).toEqual(defsAntes);
    });

    test('no-op onde as colunas já estavam corretas (como em produção) e preserva valores existentes', async () => {
        await criarTabelas({ kitId: 'INTEGER NULL', unidade: `VARCHAR(4) NOT NULL DEFAULT 'UN'` });
        await client.query(`UPDATE produtos SET unidade = 'CX' WHERE nome = 'B'`);
        await client.query(`UPDATE itens_venda SET kit_id = 1 WHERE quantidade = 3`);
        const antes = (await client.query('SELECT id, unidade FROM produtos ORDER BY id')).rows;
        const kitsAntes = (await client.query('SELECT id, kit_id FROM itens_venda ORDER BY id')).rows;

        await client.query(SQL);

        expect((await client.query('SELECT id, unidade FROM produtos ORDER BY id')).rows).toEqual(antes);
        expect((await client.query('SELECT id, kit_id FROM itens_venda ORDER BY id')).rows).toEqual(kitsAntes);
    });

    test('kit_id existente com tipo errado: falha em vez de passar em silêncio', async () => {
        await criarTabelas({ kitId: 'TEXT' });

        await expect(client.query(SQL)).rejects.toThrow(/itens_venda\.kit_id com definição inesperada/);
    });

    test('unidade existente anulável ou sem default correto: falha em vez de passar em silêncio', async () => {
        await criarTabelas({ unidade: `VARCHAR(4) DEFAULT 'UN'` });
        await expect(client.query(SQL)).rejects.toThrow(/produtos\.unidade com definição inesperada/);

        await criarTabelas({ unidade: `VARCHAR(4) NOT NULL DEFAULT 'PAR'` });
        await expect(client.query(SQL)).rejects.toThrow(/produtos\.unidade com definição inesperada/);
    });

    test('unidade com tamanho diferente de 4 só gera aviso (não derruba a migration)', async () => {
        await criarTabelas({ unidade: `VARCHAR(10) NOT NULL DEFAULT 'UN'` });

        await expect(client.query(SQL)).resolves.toBeDefined();
    });
});
