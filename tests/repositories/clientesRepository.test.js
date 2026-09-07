jest.mock('../../src/config/db');
jest.mock('../../src/repositories/shared/transacoes');

const { executarComLock } = require('../../src/repositories/shared/transacoes');
const clientesRepository = require('../../src/repositories/clientesRepository');

beforeEach(() => {
    jest.clearAllMocks();
});

// anonimizar é um caso irregular (checa `anonimizado`, não `status`), por
// isso usa executarComLock direto em vez de transicionarStatus — mesmo
// critério documentado em shared/transacoes.js.
describe('anonimizar', () => {
    function fakeClientComUpdate(retorno) {
        return { query: jest.fn().mockResolvedValue({ rows: [retorno] }) };
    }

    test('wires executarComLock with clientes/id and empresa_id', async () => {
        const client = fakeClientComUpdate({ id: 1, anonimizado: true });
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback({ id: 1, anonimizado: false }, client)
        );

        await clientesRepository.anonimizar(1, 9);

        expect(executarComLock).toHaveBeenCalledWith('clientes', { coluna: 'id', valor: 1 }, 9, undefined, expect.any(Function));
    });

    test('anonymizes nome/telefone/email, sets ativo=false and returns the updated row', async () => {
        const client = fakeClientComUpdate({
            id: 1,
            nome: 'Cliente removido',
            telefone: null,
            email: null,
            ativo: false,
            anonimizado: true,
            anonimizado_em: '2026-09-06T00:00:00.000Z'
        });
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback({ id: 1, anonimizado: false }, client)
        );

        const resultado = await clientesRepository.anonimizar(1, 9);

        expect(resultado.anonimizado).toBe(true);
        expect(resultado.anonimizado_em).toBe('2026-09-06T00:00:00.000Z');

        const [sql, valores] = client.query.mock.calls[0];
        expect(sql).toContain('UPDATE clientes SET');
        expect(sql).toContain("nome = 'Cliente removido'");
        expect(sql).toContain('telefone = NULL');
        expect(sql).toContain('email = NULL');
        expect(sql).toContain('ativo = false');
        expect(sql).toContain('anonimizado = true');
        expect(sql).toContain('anonimizado_em = NOW()');
        expect(valores).toEqual([1]);
    });

    test('throws 404 when the cliente does not exist, without touching the client', async () => {
        const client = fakeClientComUpdate({});
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback(null, client)
        );

        await expect(clientesRepository.anonimizar(999, 9)).rejects.toMatchObject({
            statusCode: 404,
            message: 'Cliente não encontrado'
        });
        expect(client.query).not.toHaveBeenCalled();
    });

    test('throws 409 when the cliente is already anonimizado, without updating', async () => {
        const client = fakeClientComUpdate({});
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback({ id: 1, anonimizado: true }, client)
        );

        await expect(clientesRepository.anonimizar(1, 9)).rejects.toMatchObject({
            statusCode: 409,
            message: 'Cliente já foi anonimizado'
        });
        expect(client.query).not.toHaveBeenCalled();
    });
});
