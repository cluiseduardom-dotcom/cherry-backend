require('dotenv').config({ quiet: true });

const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { validarUrlDeBanco } = require('../config/databaseUrl');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');
const BASELINE_MIGRATION_VERSION = 19;

// Conexão de MIGRAÇÃO, separada da de runtime. As tabelas pertencem ao papel que
// as criou (dono do schema); o papel restrito de runtime (DATABASE_URL) não tem
// e não deve ter propriedade para alterá-las. Com DATABASE_MIGRATION_URL definida,
// só o executor de migrations usa esse papel; as consultas da API continuam no
// pool de src/config/db.js (DATABASE_URL). Sem ela, usa DATABASE_URL, como antes.
// Devolve só o NOME da variável usada (nunca o valor) para mensagens e logs.
function obterConexaoMigracao(env = process.env) {
    const urlMigracao = env.DATABASE_MIGRATION_URL && env.DATABASE_MIGRATION_URL.trim();

    if (urlMigracao) {
        return { url: urlMigracao, origem: 'DATABASE_MIGRATION_URL' };
    }

    if (!env.DATABASE_URL) {
        throw new Error('DATABASE_URL não configurada');
    }

    return { url: env.DATABASE_URL, origem: 'DATABASE_URL' };
}

function criarPool(url, nomeVariavel = 'DATABASE_URL') {
    return new Pool({ connectionString: validarUrlDeBanco(url, nomeVariavel) });
}

async function listarMigrations() {
    const nomes = await fs.readdir(MIGRATIONS_DIR);

    return nomes
        .filter((nome) => /^\d+_.+\.sql$/.test(nome))
        .map((nome) => ({
            nome,
            versao: Number(nome.match(/^\d+/)[0])
        }))
        .sort((a, b) => a.versao - b.versao);
}

async function garantirTabelaMigrations(client) {
    // Com tudo já migrado, o papel de runtime (sem CREATE no schema) não pode
    // precisar de DDL só para "garantir" uma tabela que já existe.
    if (await tabelaExiste(client, 'schema_migrations')) return;

    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            filename VARCHAR(255) NOT NULL,
            applied_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);
}

async function tabelaExiste(client, nome) {
    const { rows } = await client.query(
        `SELECT to_regclass($1) IS NOT NULL AS existe`,
        [nome]
    );

    return rows[0].existe;
}

async function obterVersoesAplicadas(client) {
    const { rows } = await client.query(
        'SELECT version FROM schema_migrations ORDER BY version'
    );

    return new Set(rows.map((row) => row.version));
}

async function registrarMigration(client, migration) {
    await client.query(
        `INSERT INTO schema_migrations (version, filename)
         VALUES ($1, $2)
         ON CONFLICT (version) DO NOTHING`,
        [migration.versao, migration.nome]
    );
}

async function executarArquivoSql(client, arquivo) {
    const sql = await fs.readFile(arquivo, 'utf8');
    await client.query(sql);
}

async function aplicarMigration(client, migration) {
    await client.query('BEGIN');

    try {
        await executarArquivoSql(client, path.join(MIGRATIONS_DIR, migration.nome));
        await registrarMigration(client, migration);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

async function inicializarBanco(client, migrations) {
    const possuiEmpresas = await tabelaExiste(client, 'empresas');

    if (!possuiEmpresas) {
        await client.query('BEGIN');

        try {
            const schema = await fs.readFile(SCHEMA_FILE, 'utf8');
            await client.query(schema);

            // schema.sql só representa o schema consolidado até a migration de
            // baseline; as posteriores precisam rodar de verdade.
            const baseline = migrations.filter((migration) => migration.versao <= BASELINE_MIGRATION_VERSION);

            for (const migration of baseline) {
                await registrarMigration(client, migration);
            }

            await client.query('COMMIT');
            console.log('Schema inicial aplicado a partir de schema.sql; ' + baseline.length + ' migrations registradas como baseline.');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }

        return;
    }

    const versoes = await obterVersoesAplicadas(client);

    if (!versoes.size) {
        const baseline = migrations.find((migration) => migration.versao === BASELINE_MIGRATION_VERSION);

        if (!baseline) {
            throw new Error('Migration de baseline ' + BASELINE_MIGRATION_VERSION + ' não encontrada.');
        }

        for (const migration of migrations.filter((migration) => migration.versao < BASELINE_MIGRATION_VERSION)) {
            await registrarMigration(client, migration);
        }

        console.log('Banco legado detectado: baseline ' + (BASELINE_MIGRATION_VERSION - 1) + ' registrado.');
    }
}

async function main() {
    const { url, origem } = obterConexaoMigracao();

    const pool = criarPool(url, origem);
    const client = await pool.connect();

    try {
        const migrations = await listarMigrations();

        if (!migrations.length) {
            throw new Error('Nenhuma migration SQL encontrada');
        }

        await garantirTabelaMigrations(client);
        await inicializarBanco(client, migrations);

        const versoesAplicadas = await obterVersoesAplicadas(client);

        for (const migration of migrations) {
            if (versoesAplicadas.has(migration.versao)) continue;

            console.log('Aplicando migration ' + migration.nome + '...');
            await aplicarMigration(client, migration);
            versoesAplicadas.add(migration.versao);
        }

        const ultima = migrations.at(-1);
        console.log('Database atualizado até migration ' + ultima.nome + '.');
    } catch (error) {
        // Só o nome da variável de conexão (nunca a URL): ajuda a diagnosticar
        // migration pendente rodando com o papel restrito de runtime.
        error.message = `${error.message} (conexão de migração: ${origem})`;
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error('ERRO nas migrations:', error.message);
        process.exit(1);
    });
}

module.exports = {
    obterConexaoMigracao,
    criarPool,
    listarMigrations,
    garantirTabelaMigrations,
    tabelaExiste,
    obterVersoesAplicadas,
    registrarMigration,
    executarArquivoSql,
    aplicarMigration,
    inicializarBanco,
    main
}
