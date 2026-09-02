jest.mock('../../../src/config/db');

const db = require('../../../src/config/db');
const { executarComLock, transicionarStatus } = require('../../../src/repositories/shared/transacoes');

function makeFakeClient({ linha } = {}) {
    const client = {
        query: jest.fn(),
        release: jest.fn()
    };

    client.query.mockImplementation((sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return Promise.resolve({});
        }

        if (sql.includes('FOR UPDATE')) {
            return Promise.resolve({ rows: linha === undefined ? [] : [linha] });
        }

        return Promise.resolve({ rows: [] });
    });

    return client;
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('executarComLock', () => {
    test('locks the row, runs the callback and commits when it resolves', async () => {
        const fakeClient = makeFakeClient({ linha: { id: 1, status: 'pendente' } });
        db.connect = jest.fn().mockResolvedValue(fakeClient);
        const callback = jest.fn().mockResolvedValue({ ok: true });

        const resultado = await executarComLock('contas_pagar', { coluna: 'id', valor: 1 }, 9, undefined, callback);

        expect(resultado).toEqual({ ok: true });
        expect(callback).toHaveBeenCalledWith({ id: 1, status: 'pendente' }, fakeClient);
        expect(fakeClient.query).toHaveBeenCalledWith('BEGIN');
        expect(fakeClient.query).toHaveBeenCalledWith(
            expect.stringContaining('SELECT * FROM contas_pagar WHERE id = $1 AND empresa_id = $2 FOR UPDATE'),
            [1, 9]
        );
        expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
        expect(fakeClient.release).toHaveBeenCalledTimes(1);
    });

    test('passes null to the callback when the row does not exist, and still commits if it resolves', async () => {
        const fakeClient = makeFakeClient();
        db.connect = jest.fn().mockResolvedValue(fakeClient);
        const callback = jest.fn().mockResolvedValue(null);

        const resultado = await executarComLock('contas_receber', { coluna: 'venda_id', valor: 5 }, 9, undefined, callback);

        expect(resultado).toBeNull();
        expect(callback).toHaveBeenCalledWith(null, fakeClient);
        expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    });

    test('rolls back and releases when the callback throws', async () => {
        const fakeClient = makeFakeClient({ linha: { id: 1, status: 'pago' } });
        db.connect = jest.fn().mockResolvedValue(fakeClient);
        const erro = new Error('falhou');
        const callback = jest.fn().mockRejectedValue(erro);

        await expect(
            executarComLock('contas_pagar', { coluna: 'id', valor: 1 }, 9, undefined, callback)
        ).rejects.toThrow('falhou');

        expect(fakeClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(fakeClient.query).not.toHaveBeenCalledWith('COMMIT');
        expect(fakeClient.release).toHaveBeenCalledTimes(1);
    });

    test('uses the coluna given for the lock, not always id', async () => {
        const fakeClient = makeFakeClient({ linha: { id: 5, venda_id: 1, status: 'pendente' } });
        db.connect = jest.fn().mockResolvedValue(fakeClient);

        await executarComLock('contas_receber', { coluna: 'venda_id', valor: 1 }, 9, undefined, jest.fn().mockResolvedValue(null));

        expect(fakeClient.query).toHaveBeenCalledWith(
            expect.stringContaining('WHERE venda_id = $1 AND empresa_id = $2 FOR UPDATE'),
            [1, 9]
        );
    });

    describe('with clienteExterno', () => {
        test('does not manage BEGIN/COMMIT/release, only runs the callback', async () => {
            const fakeClient = makeFakeClient({ linha: { id: 1, status: 'pendente' } });
            const callback = jest.fn().mockResolvedValue({ ok: true });

            const resultado = await executarComLock('contas_receber', { coluna: 'venda_id', valor: 1 }, 9, fakeClient, callback);

            expect(resultado).toEqual({ ok: true });
            const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
            expect(sqlChamados).not.toContain('BEGIN');
            expect(sqlChamados).not.toContain('COMMIT');
            expect(fakeClient.release).not.toHaveBeenCalled();
        });

        test('propagates the callback error without touching the transaction or releasing', async () => {
            const fakeClient = makeFakeClient({ linha: { id: 1, status: 'recebido' } });
            const erro = new Error('falhou');

            await expect(
                executarComLock('contas_receber', { coluna: 'venda_id', valor: 1 }, 9, fakeClient, jest.fn().mockRejectedValue(erro))
            ).rejects.toThrow('falhou');

            const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
            expect(sqlChamados).not.toContain('ROLLBACK');
            expect(sqlChamados).not.toContain('COMMIT');
            expect(fakeClient.release).not.toHaveBeenCalled();
        });
    });
});

describe('transicionarStatus', () => {
    test('updates and commits when the row matches statusEsperado', async () => {
        const fakeClient = makeFakeClient({ linha: { id: 1, status: 'pendente' } });
        fakeClient.query.mockImplementation((sql, params = []) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({});
            if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [{ id: 1, status: 'pendente' }] });
            if (sql.startsWith('UPDATE')) return Promise.resolve({ rows: [{ id: params[0], status: 'pago' }] });
            return Promise.resolve({ rows: [] });
        });
        db.connect = jest.fn().mockResolvedValue(fakeClient);

        const resultado = await transicionarStatus('contas_pagar', 1, 9, {
            statusEsperado: 'pendente',
            mensagemNaoEncontrado: 'Conta a pagar não encontrada',
            mensagemStatusInvalido: 'Somente contas pendentes podem ser marcadas como pagas',
            sets: `status = 'pago', data_pagamento = CURRENT_DATE`
        });

        expect(resultado.status).toBe('pago');
        expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    });

    test('throws 404 with mensagemNaoEncontrado and rolls back when the row does not exist', async () => {
        const fakeClient = makeFakeClient();
        db.connect = jest.fn().mockResolvedValue(fakeClient);

        await expect(
            transicionarStatus('contas_receber', 999, 9, {
                statusEsperado: 'pendente',
                mensagemNaoEncontrado: 'Conta a receber não encontrada',
                mensagemStatusInvalido: 'Somente contas pendentes podem ser marcadas como recebidas',
                sets: `status = 'recebido'`
            })
        ).rejects.toMatchObject({ statusCode: 404, message: 'Conta a receber não encontrada' });

        expect(fakeClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    test('throws 409 with mensagemStatusInvalido and rolls back when the status does not match', async () => {
        const fakeClient = makeFakeClient({ linha: { id: 1, status: 'pago' } });
        db.connect = jest.fn().mockResolvedValue(fakeClient);

        await expect(
            transicionarStatus('contas_pagar', 1, 9, {
                statusEsperado: 'pendente',
                mensagemNaoEncontrado: 'Conta a pagar não encontrada',
                mensagemStatusInvalido: 'Somente contas pendentes podem ser canceladas',
                sets: `status = 'cancelado'`
            })
        ).rejects.toMatchObject({ statusCode: 409, message: 'Somente contas pendentes podem ser canceladas' });

        expect(fakeClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
});
