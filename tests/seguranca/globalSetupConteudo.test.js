// Executa o globalSetup e o script de marcação com o `pg` SIMULADO (nenhuma conexão real):
// prova a ordem (identidade -> marca -> conteúdo) e que nada é escrito antes de o banco
// provar que é descartável.

const mockQueries = [];
let mockRespostas;

jest.mock('pg', () => ({
    Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        end: jest.fn().mockResolvedValue(undefined),
        query: jest.fn(async (sql) => {
            mockQueries.push(sql);
            return mockRespostas(sql);
        }),
    })),
}));

const globalSetup = require('../integration/globalSetup');
const { main: marcar } = require('../integration/marcarBancoDescartavel');

const URL_LOCAL = 'postgresql://cherry:cherry@localhost:5432/cherry_test';

function banco({ comentario = 'cherry-test-disposable', empresas = [], temTabela = true } = {}) {
    return async (sql) => {
        if (/current_database\(\) AS banco/.test(sql)) return { rows: [{ banco: 'cherry_test' }] };
        if (/shobj_description/.test(sql)) return { rows: [{ comentario }] };
        if (/to_regclass/.test(sql)) return { rows: [{ t: temTabela ? 'empresas' : null }] };
        if (/FROM empresas/.test(sql)) return { rows: empresas };
        return { rows: [] };
    };
}

const escritas = () => mockQueries.filter((q) => /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|COMMENT)/i.test(q));

let envAnterior;

beforeEach(() => {
    mockQueries.length = 0;
    envAnterior = { ...process.env };
    process.env.TEST_DATABASE_URL = URL_LOCAL;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_MIGRATION_URL;
    delete process.env.NODE_ENV;
});

afterEach(() => {
    process.env = envAnterior;
});

describe('globalSetup: marca e conteúdo', () => {
    test('banco marcado, com o seed e resíduos de teste: passa e só faz SELECT', async () => {
        mockRespostas = banco({ empresas: [{ id: 1, nome: 'Cherry Semijoias' }, { id: 9, nome: 'Teste X' }] });

        await expect(globalSetup()).resolves.toBeUndefined();
        expect(escritas()).toEqual([]);
    });

    test('banco vazio e sem tabela empresas, mas marcado: passa', async () => {
        mockRespostas = banco({ temTabela: false });

        await expect(globalSetup()).resolves.toBeUndefined();
    });

    test('sem a marca: aborta, cita o destino e NÃO consulta empresas', async () => {
        mockRespostas = banco({ comentario: null, empresas: [{ id: 5, nome: 'Real' }] });

        await expect(globalSetup()).rejects.toThrow(/não está marcado como descartável.*localhost\/cherry_test/s);
        expect(mockQueries.some((q) => /FROM empresas/.test(q))).toBe(false);
        expect(escritas()).toEqual([]);
    });

    test('marcado mas com empresa real: aborta sem vazar o nome', async () => {
        mockRespostas = banco({ empresas: [{ id: 88, nome: 'Cliente Secreto SA' }] });

        const erro = await globalSetup().catch((e) => e);

        expect(erro.message).toMatch(/ids: 88/);
        expect(erro.message).not.toMatch(/Secreto/);
        expect(escritas()).toEqual([]);
    });

    test('URL de banco compartilhado ainda é barrada antes de qualquer conexão', async () => {
        process.env.TEST_DATABASE_URL = 'postgresql://u:p@ep-x.neon.tech/neondb';
        mockRespostas = banco();

        await expect(globalSetup()).rejects.toThrow(/BLOQUEADOS/);
        expect(mockQueries).toEqual([]);
    });
});

describe('marcarBancoDescartavel', () => {
    test('banco com só seed/testes: escreve apenas o COMMENT com a marca', async () => {
        mockRespostas = banco({ comentario: null, empresas: [{ id: 1, nome: 'Cherry Semijoias' }] });

        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        await marcar();
        log.mockRestore();

        expect(escritas()).toEqual([`COMMENT ON DATABASE "cherry_test" IS 'cherry-test-disposable'`]);
    });

    test('banco com empresa real NÃO é marcado', async () => {
        mockRespostas = banco({ comentario: null, empresas: [{ id: 42, nome: 'Loja Real' }] });

        await expect(marcar()).rejects.toThrow(/dados reais/);
        expect(escritas()).toEqual([]);
    });

    test('URL inválida/compartilhada nem conecta', async () => {
        process.env.TEST_DATABASE_URL = 'postgresql://u:p@ep-x.neon.tech/neondb';
        mockRespostas = banco();

        await expect(marcar()).rejects.toThrow(/BLOQUEADOS/);
        expect(mockQueries).toEqual([]);
    });
});

