// Conexão de migração separada da de runtime. Tudo com pg MOCKADO: nenhum teste
// aqui abre conexão real com banco nenhum.

jest.mock('pg', () => ({ Pool: jest.fn() }));

const path = require('node:path');
const { Pool } = require('pg');
const { obterConexaoMigracao, main, listarMigrations } = require('../../src/database/migrate');

const SEGREDO = 'SEGREDO-NAO-PODE-VAZAR';
const URL_RUNTIME = `postgresql://vertumno_runtime:${SEGREDO}-runtime@host-runtime.invalid/db`;
const URL_MIGRACAO = `postgresql://dono_schema:${SEGREDO}-migracao@host-migracao.invalid/db`;

const ENV_ORIGINAL = { ...process.env };

function restaurarEnv() {
    for (const chave of ['DATABASE_URL', 'DATABASE_MIGRATION_URL']) {
        if (ENV_ORIGINAL[chave] === undefined) delete process.env[chave];
        else process.env[chave] = ENV_ORIGINAL[chave];
    }
}

// Cliente falso: `aplicadas` = versões já registradas em schema_migrations;
// `negarMigration` = o SQL da migration (a 1ª consulta depois do BEGIN) falha com
// permissão negada, como o papel restrito de runtime tentando alterar tabela alheia.
function bancoFalso({ aplicadas, negarMigration = false, erro = 'must be owner of table politicas_taxa_plataforma' }) {
    let ultimaConsulta = '';
    const client = {
        release: jest.fn(),
        query: jest.fn(async (sql) => {
            const anterior = ultimaConsulta;
            ultimaConsulta = sql;

            if (sql.includes('to_regclass')) return { rows: [{ existe: true }] }; // empresas e schema_migrations existem
            if (sql.includes('SELECT version FROM schema_migrations')) {
                return { rows: [...aplicadas].map((version) => ({ version })) };
            }
            if (negarMigration && anterior === 'BEGIN' && sql !== 'ROLLBACK') throw new Error(erro);
            return { rows: [] };
        })
    };
    const pool = { connect: jest.fn(async () => client), end: jest.fn(async () => {}) };
    Pool.mockImplementation(() => pool);

    return { client, pool };
}

async function todasAsVersoes() {
    return (await listarMigrations()).map((migration) => migration.versao);
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.DATABASE_MIGRATION_URL;
    process.env.DATABASE_URL = URL_RUNTIME;
});

afterEach(() => {
    jest.restoreAllMocks();
    restaurarEnv();
});

describe('obterConexaoMigracao', () => {
    test('usa DATABASE_MIGRATION_URL quando definida, devolvendo só o NOME da variável como origem', () => {
        const conexao = obterConexaoMigracao({ DATABASE_URL: URL_RUNTIME, DATABASE_MIGRATION_URL: URL_MIGRACAO });

        expect(conexao).toEqual({ url: URL_MIGRACAO, origem: 'DATABASE_MIGRATION_URL' });
    });

    test('sem DATABASE_MIGRATION_URL (ou em branco), mantém a compatibilidade e usa DATABASE_URL', () => {
        expect(obterConexaoMigracao({ DATABASE_URL: URL_RUNTIME })).toEqual({ url: URL_RUNTIME, origem: 'DATABASE_URL' });
        expect(obterConexaoMigracao({ DATABASE_URL: URL_RUNTIME, DATABASE_MIGRATION_URL: '   ' }))
            .toEqual({ url: URL_RUNTIME, origem: 'DATABASE_URL' });
        expect(obterConexaoMigracao({ DATABASE_URL: URL_RUNTIME, DATABASE_MIGRATION_URL: '' }).origem).toBe('DATABASE_URL');
    });

    test('sem nenhuma das duas, falha com a mensagem de sempre e sem expor valores', () => {
        expect(() => obterConexaoMigracao({})).toThrow('DATABASE_URL não configurada');
        expect(() => obterConexaoMigracao({ DATABASE_MIGRATION_URL: '  ' })).toThrow('DATABASE_URL não configurada');
    });

    test('só DATABASE_MIGRATION_URL definida (sem DATABASE_URL) também é aceita pelo executor', () => {
        expect(obterConexaoMigracao({ DATABASE_MIGRATION_URL: URL_MIGRACAO }).origem).toBe('DATABASE_MIGRATION_URL');
    });
});

describe('main: qual conexão o executor de migrations usa', () => {
    test('com DATABASE_MIGRATION_URL, o pool de migração usa essa URL e NÃO a de runtime', async () => {
        process.env.DATABASE_MIGRATION_URL = URL_MIGRACAO;
        bancoFalso({ aplicadas: await todasAsVersoes() });

        await main();

        expect(Pool).toHaveBeenCalledTimes(1);
        expect(Pool).toHaveBeenCalledWith({ connectionString: URL_MIGRACAO });
        expect(Pool).not.toHaveBeenCalledWith({ connectionString: URL_RUNTIME });
    });

    test('sem DATABASE_MIGRATION_URL e com migrations já aplicadas, a aplicação sobe usando DATABASE_URL, só com leitura (sem DDL, INSERT ou transação)', async () => {
        const { client, pool } = bancoFalso({ aplicadas: await todasAsVersoes() });

        await expect(main()).resolves.toBeUndefined();

        expect(Pool).toHaveBeenCalledWith({ connectionString: URL_RUNTIME });
        const sqls = client.query.mock.calls.map(([sql]) => sql);
        expect(sqls.filter((sql) => /CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|BEGIN|COMMIT/i.test(sql))).toEqual([]);
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(pool.end).toHaveBeenCalledTimes(1);
    });

    test('o papel de runtime não precisa criar schema_migrations: se ela já existe, nenhum CREATE TABLE é emitido', async () => {
        const { client } = bancoFalso({ aplicadas: await todasAsVersoes() });

        await main();

        expect(client.query.mock.calls.some(([sql]) => /CREATE TABLE/i.test(sql))).toBe(false);
    });
});

describe('main: falha de migration impede a inicialização de forma segura', () => {
    async function versoesSemUltima() {
        const todas = await todasAsVersoes();
        return { todas, aplicadas: todas.slice(0, -1) };
    }

    test('migration pendente sem permissão (papel restrito): faz ROLLBACK, libera cliente e pool e rejeita', async () => {
        const { aplicadas } = await versoesSemUltima();
        const { client, pool } = bancoFalso({ aplicadas, negarMigration: true });

        await expect(main()).rejects.toThrow('must be owner of table politicas_taxa_plataforma');

        const sqls = client.query.mock.calls.map(([sql]) => sql);
        expect(sqls).toContain('BEGIN');
        expect(sqls).toContain('ROLLBACK');
        expect(sqls).not.toContain('COMMIT');
        expect(sqls.some((sql) => sql.includes('INSERT INTO schema_migrations'))).toBe(false); // não registra como aplicada
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(pool.end).toHaveBeenCalledTimes(1);
    });

    test('a mensagem de falha informa só o NOME da variável de conexão, nunca a URL nem a senha', async () => {
        const { aplicadas } = await versoesSemUltima();
        bancoFalso({ aplicadas, negarMigration: true });

        const semMigracao = await main().catch((erro) => erro);
        expect(semMigracao.message).toContain('(conexão de migração: DATABASE_URL)');

        process.env.DATABASE_MIGRATION_URL = URL_MIGRACAO;
        bancoFalso({ aplicadas, negarMigration: true });
        const comMigracao = await main().catch((erro) => erro);
        expect(comMigracao.message).toContain('(conexão de migração: DATABASE_MIGRATION_URL)');

        for (const erro of [semMigracao, comMigracao]) {
            expect(erro.message).not.toContain(SEGREDO);
            expect(erro.message).not.toContain('host-runtime.invalid');
            expect(erro.message).not.toContain('host-migracao.invalid');
        }
        const logs = console.log.mock.calls.flat().join(' ');
        expect(logs).not.toContain(SEGREDO);
    });

    test('falha ao conectar no banco de migração também libera o pool e rejeita sem vazar a URL', async () => {
        process.env.DATABASE_MIGRATION_URL = URL_MIGRACAO;
        const pool = { connect: jest.fn(async () => { throw new Error('connection refused'); }), end: jest.fn() };
        Pool.mockImplementation(() => pool);

        await expect(main()).rejects.toThrow('connection refused');
    });

    test('sem nenhuma URL de banco, rejeita antes de abrir qualquer conexão', async () => {
        delete process.env.DATABASE_URL;

        await expect(main()).rejects.toThrow('DATABASE_URL não configurada');
        expect(Pool).not.toHaveBeenCalled();
    });
});

describe('o arquivo de migrations 048 existe e é a última versão considerada', () => {
    test('a lista de migrations inclui a 048 (a que exigia propriedade das tabelas)', async () => {
        const nomes = (await listarMigrations()).map((migration) => path.basename(migration.nome));
        expect(nomes).toContain('048_planos_comerciais_taxa_plataforma.sql');
    });
});
