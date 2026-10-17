const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/049_empresas_tema_visual.sql'), 'utf8');

// Roda só no projeto de integração (TEST_DATABASE_URL validada pelo globalSetup) e SOMENTE num
// schema temporário próprio: nunca toca nas tabelas reais.
describe('migration 049 — comportamento em schema isolado', () => {
    const schema = `mig049_${crypto.randomBytes(4).toString('hex')}`;
    let client;

    const empresas = async () => (await client.query('SELECT id, nome, tema_visual FROM empresas ORDER BY id')).rows;

    beforeEach(async () => {
        await client.query('DROP TABLE IF EXISTS empresas');
        await client.query(`CREATE TABLE empresas (
            id SERIAL PRIMARY KEY, nome VARCHAR(255) NOT NULL, cnpj VARCHAR(20),
            status VARCHAR(20) NOT NULL DEFAULT 'ativa', criado_em TIMESTAMP NOT NULL DEFAULT NOW())`);
        await client.query(`INSERT INTO ${schema}.empresas (nome) VALUES ('Cherry Semijoias'), ('Outra Loja'), ('cherry semijoias')`);
    });

    beforeAll(async () => {
        // Explícito: só a TEST_DATABASE_URL (já validada pelo globalSetup), nunca o DATABASE_URL.
        client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
        await client.connect();
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`SET search_path TO ${schema}`);
    });

    afterAll(async () => {
        if (!client) return;

        try {
            await client.query('SET search_path TO public');
            await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        } finally {
            await client.end();
        }
    });

    test('só a Cherry Semijoias vira cherry; as demais ficam em vertumno', async () => {
        await client.query(SQL);

        expect(await empresas()).toEqual([
            { id: 1, nome: 'Cherry Semijoias', tema_visual: 'cherry' },
            { id: 2, nome: 'Outra Loja', tema_visual: 'vertumno' },
            { id: 3, nome: 'cherry semijoias', tema_visual: 'vertumno' }
        ]);
    });

    test('idempotente: rodar de novo não falha nem altera nada', async () => {
        await client.query(SQL);
        const antes = await empresas();

        await client.query(SQL);
        await client.query(SQL);

        expect(await empresas()).toEqual(antes);
    });

    test('o CHECK rejeita tema fora do conjunto fechado, inclusive em UPDATE', async () => {
        await client.query(SQL);

        await expect(client.query(`INSERT INTO ${schema}.empresas (nome, tema_visual) VALUES ('X', 'rosa')`)).rejects.toThrow(/empresas_tema_visual_chk/);
        await expect(client.query(`UPDATE empresas SET tema_visual = 'CHERRY' WHERE id = 2`)).rejects.toThrow(/empresas_tema_visual_chk/);
        await expect(client.query(`UPDATE empresas SET tema_visual = NULL WHERE id = 2`)).rejects.toThrow(/null/i);
    });

    test('empresa criada depois, sem informar o tema, nasce em vertumno', async () => {
        await client.query(SQL);
        await client.query(`INSERT INTO ${schema}.empresas (nome) VALUES ('Nova')`);

        expect((await empresas()).pop()).toMatchObject({ nome: 'Nova', tema_visual: 'vertumno' });
    });
});
