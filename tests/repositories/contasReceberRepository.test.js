jest.mock('../../src/config/db');
jest.mock('../../src/repositories/shared/transacoes');

const db = require('../../src/config/db');
const { executarComLock, transicionarStatus } = require('../../src/repositories/shared/transacoes');
const contasReceberRepository = require('../../src/repositories/contasReceberRepository');

beforeEach(() => {
    jest.clearAllMocks();
});

// criar é INSERT puro com participação em transação externa (candidato 2,
// fora do escopo desta migração) — segue com um fake de client próprio.
describe('criar', () => {
    function makeFakeClient() {
        const client = { query: jest.fn(), release: jest.fn() };
        client.query.mockImplementation((sql, params = []) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
                return Promise.resolve({});
            }
            if (sql.includes('INSERT INTO contas_receber')) {
                return Promise.resolve({
                    rows: [{ id: 1, venda_id: params[0], descricao: params[1], valor: params[2], data_vencimento: params[3], empresa_id: params[4], status: 'pendente' }]
                });
            }
            return Promise.resolve({ rows: [] });
        });
        return client;
    }

    test('opens and commits its own transaction when no clienteExterno is given', async () => {
        const fakeClient = makeFakeClient();
        db.connect = jest.fn().mockResolvedValue(fakeClient);

        const resultado = await contasReceberRepository.criar({
            venda_id: 1, descricao: 'Venda #1', valor: 100, data_vencimento: '2026-08-30', empresa_id: 9
        });

        expect(resultado.status).toBe('pendente');
        expect(fakeClient.query).toHaveBeenCalledWith('BEGIN');
        expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
        expect(fakeClient.release).toHaveBeenCalledTimes(1);
    });

    test('reuses an external client without managing the transaction', async () => {
        const fakeClient = makeFakeClient();

        const resultado = await contasReceberRepository.criar({
            venda_id: 1, descricao: 'Venda #1', valor: 100, data_vencimento: '2026-08-30', empresa_id: 9
        }, fakeClient);

        expect(resultado.status).toBe('pendente');
        const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
        expect(sqlChamados).not.toContain('BEGIN');
        expect(sqlChamados).not.toContain('COMMIT');
        expect(fakeClient.release).not.toHaveBeenCalled();
    });
});

// cancelarPorVendaId usa executarComLock direto (ramificação irregular: no-op
// sem conta vinculada, devolve como está se já cancelada) — mecânica de
// lock/commit/rollback já coberta em tests/repositories/shared/transacoes.test.js.
describe('cancelarPorVendaId', () => {
    function fakeClientComUpdate(retorno) {
        return { query: jest.fn().mockResolvedValue({ rows: [retorno] }) };
    }

    test('wires executarComLock with contas_receber/venda_id', async () => {
        const client = fakeClientComUpdate({ id: 5, status: 'cancelado' });
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback({ id: 5, status: 'pendente' }, client)
        );

        const resultado = await contasReceberRepository.cancelarPorVendaId(1, 9);

        expect(resultado).toEqual({ id: 5, status: 'cancelado' });
        expect(executarComLock).toHaveBeenCalledWith('contas_receber', { coluna: 'venda_id', valor: 1 }, 9, undefined, expect.any(Function));

        const [sql, valores] = client.query.mock.calls[0];
        expect(sql).toContain(`SET status = 'cancelado'`);
        expect(valores).toEqual([5]);
    });

    test('is a no-op when the venda has no linked conta (à vista sale)', async () => {
        const client = fakeClientComUpdate({});
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback(null, client)
        );

        const resultado = await contasReceberRepository.cancelarPorVendaId(1, 9);

        expect(resultado).toBeNull();
        expect(client.query).not.toHaveBeenCalled();
    });

    test('throws 409 and does not update when the conta is already recebida', async () => {
        const client = fakeClientComUpdate({});
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback({ id: 5, status: 'recebido' }, client)
        );

        await expect(contasReceberRepository.cancelarPorVendaId(1, 9)).rejects.toMatchObject({
            statusCode: 409,
            message: 'Venda com conta a receber já recebida não pode ser cancelada'
        });
        expect(client.query).not.toHaveBeenCalled();
    });

    test('returns the conta unchanged, without updating, when already cancelada', async () => {
        const client = fakeClientComUpdate({});
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback({ id: 5, status: 'cancelado' }, client)
        );

        const resultado = await contasReceberRepository.cancelarPorVendaId(1, 9);

        expect(resultado).toEqual({ id: 5, status: 'cancelado' });
        expect(client.query).not.toHaveBeenCalled();
    });

    test('forwards clienteExterno to executarComLock', async () => {
        const clienteExterno = { query: jest.fn() };
        executarComLock.mockResolvedValue(null);

        await contasReceberRepository.cancelarPorVendaId(1, 9, clienteExterno);

        expect(executarComLock).toHaveBeenCalledWith('contas_receber', { coluna: 'venda_id', valor: 1 }, 9, clienteExterno, expect.any(Function));
    });
});

// marcarComoRecebida é wiring puro sobre transicionarStatus.
describe('marcarComoRecebida', () => {
    test('calls transicionarStatus with the right table, status and sets', async () => {
        transicionarStatus.mockResolvedValue({ id: 1, status: 'recebido' });

        const resultado = await contasReceberRepository.marcarComoRecebida(1, 9);

        expect(resultado).toEqual({ id: 1, status: 'recebido' });
        expect(transicionarStatus).toHaveBeenCalledWith('contas_receber', 1, 9, {
            statusEsperado: 'pendente',
            mensagemNaoEncontrado: 'Conta a receber não encontrada',
            mensagemStatusInvalido: 'Somente contas pendentes podem ser marcadas como recebidas',
            sets: `status = 'recebido', data_recebimento = CURRENT_DATE`
        });
    });
});

describe('listarPaginado', () => {
    test('filters by empresa_id even when no other filter is provided', async () => {
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 1 }] })
            .mockResolvedValueOnce({ rows: [{ count: '1' }] });

        const resultado = await contasReceberRepository.listarPaginado({ limit: 20, offset: 0, empresa_id: 9 });

        expect(resultado).toEqual({ items: [{ id: 1 }], total: 1 });
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('WHERE empresa_id = $1');
        expect(params).toEqual([9, 20, 0]);
    });

    test('applies a status filter alongside empresa_id', async () => {
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ count: '0' }] });

        await contasReceberRepository.listarPaginado({ limit: 20, offset: 0, status: 'pendente', empresa_id: 9 });

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('empresa_id = $1');
        expect(sql).toContain('status = $2');
        expect(params).toEqual([9, 'pendente', 20, 0]);
    });

    test('applies vencimentoDe and vencimentoAte together with empresa_id', async () => {
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ count: '0' }] });

        const de = '2026-01-01';
        const ate = '2026-12-31';

        await contasReceberRepository.listarPaginado({ limit: 20, offset: 0, vencimentoDe: de, vencimentoAte: ate, empresa_id: 9 });

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('empresa_id = $1');
        expect(sql).toContain('data_vencimento >= $2');
        expect(sql).toContain('data_vencimento <= $3');
        expect(params).toEqual([9, de, ate, 20, 0]);
    });
});

describe('buscarPorId', () => {
    test('filters by id and empresa_id', async () => {
        db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1 }] });

        const resultado = await contasReceberRepository.buscarPorId(1, 9);

        expect(resultado).toEqual({ id: 1 });
        expect(db.query).toHaveBeenCalledWith(
            'SELECT * FROM contas_receber WHERE id = $1 AND empresa_id = $2',
            [1, 9]
        );
    });

    test('returns null when not found', async () => {
        db.query = jest.fn().mockResolvedValue({ rows: [] });

        const resultado = await contasReceberRepository.buscarPorId(999, 9);

        expect(resultado).toBeNull();
    });
});
