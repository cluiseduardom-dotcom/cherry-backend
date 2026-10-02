jest.mock('../../src/config/db');
jest.mock('../../src/repositories/shared/transacoes');

const db = require('../../src/config/db');
const { executarComLock } = require('../../src/repositories/shared/transacoes');
const clientesRepository = require('../../src/repositories/clientesRepository');

beforeEach(() => {
    jest.clearAllMocks();
});

describe('criar', () => {
    test('inserts nome/telefone/email plus the cadastral fields with the given empresa_id', async () => {
        db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nome: 'Cliente X', empresa_id: 9 }] });

        const resultado = await clientesRepository.criar({
            nome: 'Cliente X',
            telefone: '11999999999',
            email: 'x@example.com',
            cpf_cnpj: '12345678901',
            cep: '01310-100',
            endereco: 'Av. Paulista',
            numero: '1000',
            complemento: 'Sala 10',
            bairro: 'Bela Vista',
            cidade: 'São Paulo',
            uf: 'SP',
            data_nascimento: '1990-05-20',
            observacoes: 'Prefere contato por telefone',
            empresa_id: 9
        });

        expect(resultado.id).toBe(1);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('INSERT INTO clientes');
        expect(params).toEqual([
            'Cliente X',
            '11999999999',
            'x@example.com',
            '12345678901',
            '01310-100',
            'Av. Paulista',
            '1000',
            'Sala 10',
            'Bela Vista',
            'São Paulo',
            'SP',
            '1990-05-20',
            'Prefere contato por telefone',
            9
        ]);
    });

    test('inserts null for cadastral fields that were not provided', async () => {
        db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nome: 'Cliente X', empresa_id: 9 }] });

        await clientesRepository.criar({ nome: 'Cliente X', empresa_id: 9 });

        const [, params] = db.query.mock.calls[0];
        expect(params).toEqual([
            'Cliente X',
            undefined,
            undefined,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            9
        ]);
    });
});

describe('buscarPorId', () => {
    test('scopes the lookup by id AND empresa_id in the same query', async () => {
        db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, empresa_id: 9 }] });

        const resultado = await clientesRepository.buscarPorId(1, 9);

        expect(resultado).toEqual({ id: 1, empresa_id: 9 });
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('WHERE id = $1 AND empresa_id = $2');
        expect(params).toEqual([1, 9]);
    });

    test('returns null when no row matches id + empresa_id (e.g. cliente from another empresa)', async () => {
        db.query = jest.fn().mockResolvedValue({ rows: [] });

        const resultado = await clientesRepository.buscarPorId(999, 9);
        expect(resultado).toBeNull();
    });
});

describe('atualizar', () => {
    test('scopes the update by id AND empresa_id, updating only provided fields', async () => {
        db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nome: 'Novo Nome', empresa_id: 9 }] });

        const resultado = await clientesRepository.atualizar(1, { nome: 'Novo Nome' }, 9);

        expect(resultado.nome).toBe('Novo Nome');
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('UPDATE clientes SET');
        expect(sql).not.toContain('atualizado_em');
        expect(sql).toContain('WHERE id = $2 AND empresa_id = $3');
        expect(params).toEqual(['Novo Nome', 1, 9]);
    });

    test('builds the dynamic SET with multiple provided cadastral fields', async () => {
        db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, cidade: 'Rio de Janeiro', uf: 'RJ' }] });

        await clientesRepository.atualizar(1, { cidade: 'Rio de Janeiro', uf: 'RJ' }, 9);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('cidade = $1');
        expect(sql).toContain('uf = $2');
        expect(sql).toContain('WHERE id = $3 AND empresa_id = $4');
        expect(params).toEqual(['Rio de Janeiro', 'RJ', 1, 9]);
    });

    test('returns null when the cliente does not belong to this empresa', async () => {
        db.query = jest.fn().mockResolvedValue({ rows: [] });

        const resultado = await clientesRepository.atualizar(1, { nome: 'X' }, 9);
        expect(resultado).toBeNull();
    });
});

describe('getHistorico', () => {
    test('includes v.total AS total_venda in the SELECT', async () => {
        db.query = jest.fn().mockResolvedValue({ rows: [{ venda_id: 1, total_venda: 150 }] });

        const resultado = await clientesRepository.getHistorico(1, 9);

        expect(resultado).toEqual([{ venda_id: 1, total_venda: 150 }]);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('v.total AS total_venda');
        expect(params).toEqual([1, 9]);
    });
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
        expect(sql).toContain('cpf_cnpj = NULL');
        expect(sql).toContain('cep = NULL');
        expect(sql).toContain('endereco = NULL');
        expect(sql).toContain('numero = NULL');
        expect(sql).toContain('complemento = NULL');
        expect(sql).toContain('bairro = NULL');
        expect(sql).toContain('cidade = NULL');
        expect(sql).toContain('uf = NULL');
        expect(sql).toContain('data_nascimento = NULL');
        expect(sql).toContain('observacoes = NULL');
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
