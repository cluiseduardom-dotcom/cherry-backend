// A API (pool de runtime) continua no papel restrito de DATABASE_URL; a falha de
// migration impede o servidor de subir. Tudo mockado: nenhum teste abre conexão real.

const ENV_ORIGINAL = { ...process.env };

const SEGREDO = 'SEGREDO-NAO-PODE-VAZAR';
const URL_RUNTIME = `postgresql://vertumno_runtime:${SEGREDO}-runtime@host-runtime.invalid/db`;
const URL_MIGRACAO = `postgresql://dono_schema:${SEGREDO}-migracao@host-migracao.invalid/db`;

afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    for (const chave of ['DATABASE_URL', 'DATABASE_MIGRATION_URL']) {
        if (ENV_ORIGINAL[chave] === undefined) delete process.env[chave];
        else process.env[chave] = ENV_ORIGINAL[chave];
    }
});

describe('pool de runtime (src/config/db.js)', () => {
    test('usa DATABASE_URL e nunca DATABASE_MIGRATION_URL, mesmo quando as duas existem', () => {
        process.env.DATABASE_URL = URL_RUNTIME;
        process.env.DATABASE_MIGRATION_URL = URL_MIGRACAO;
        const Pool = jest.fn();

        jest.isolateModules(() => {
            jest.doMock('pg', () => ({ Pool }));
            require('../../src/config/db');
        });

        expect(Pool).toHaveBeenCalledTimes(1);
        expect(Pool).toHaveBeenCalledWith({ connectionString: URL_RUNTIME, ssl: { rejectUnauthorized: true } });
    });
});

describe('src/server.js: inicialização', () => {
    function carregarServidor({ migrations }) {
        const listen = jest.fn();
        const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
        const erro = jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});

        jest.isolateModules(() => {
            jest.doMock('../../src/app', () => ({ listen }));
            jest.doMock('../../src/config/runtimeConfig', () => ({ validarRuntime: jest.fn() }));
            jest.doMock('../../src/database/migrate', () => ({ main: migrations }));
            require('../../src/server');
        });

        return { listen, exit, erro };
    }

    const aguardar = () => new Promise((resolve) => setImmediate(resolve));

    test('migrations aplicadas com sucesso: o servidor sobe', async () => {
        const { listen, exit } = carregarServidor({ migrations: jest.fn().mockResolvedValue(undefined) });
        await aguardar();

        expect(listen).toHaveBeenCalledTimes(1);
        expect(exit).not.toHaveBeenCalled();
    });

    test('migration falha (ex.: permissão negada): o servidor NÃO sobe, encerra com código 1 e loga só a mensagem', async () => {
        const falha = new Error('must be owner of table politicas_taxa_plataforma (conexão de migração: DATABASE_URL)');
        falha.stack = `Error: ${SEGREDO}\n    at stack-com-detalhes`;
        const { listen, exit, erro } = carregarServidor({ migrations: jest.fn().mockRejectedValue(falha) });
        await aguardar();

        expect(listen).not.toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(1);
        expect(erro).toHaveBeenCalledWith('Falha ao iniciar o servidor:', falha.message);
        expect(JSON.stringify(erro.mock.calls)).not.toContain(SEGREDO);
    });
});
