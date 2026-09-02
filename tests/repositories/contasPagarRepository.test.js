jest.mock('../../src/config/db');
jest.mock('../../src/repositories/shared/transacoes');

const db = require('../../src/config/db');
const { executarComLock, transicionarStatus } = require('../../src/repositories/shared/transacoes');
const contasPagarRepository = require('../../src/repositories/contasPagarRepository');

function makeFakeClient({ conta = {}, contaPorCompra = {} } = {}) {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return Promise.resolve({});
    }

    if (sql.includes('INSERT INTO contas_pagar')) {
      return Promise.resolve({
        rows: [{ id: 1, descricao: params[0], fornecedor: params[1], valor: params[2], data_vencimento: params[3], empresa_id: params[7], compra_id: params[8], status: 'pendente' }]
      });
    }

    if (sql.includes('SELECT * FROM contas_pagar WHERE id = $1 AND empresa_id = $2 FOR UPDATE')) {
      return Promise.resolve({
        rows: conta.existe === false ? [] : [{ id: params[0], status: conta.status ?? 'pendente' }]
      });
    }

    if (sql.includes('SELECT * FROM contas_pagar WHERE compra_id = $1 AND empresa_id = $2 FOR UPDATE')) {
      return Promise.resolve({
        rows: contaPorCompra.existe === false ? [] : [{ id: contaPorCompra.id ?? 1, status: contaPorCompra.status ?? 'pendente' }]
      });
    }

    if (sql.includes("SET status = 'pago'")) {
      return Promise.resolve({ rows: [{ id: params[0], status: 'pago', data_pagamento: '2026-07-27' }] });
    }

    if (sql.includes("SET status = 'cancelado'")) {
      return Promise.resolve({ rows: [{ id: params[0], status: 'cancelado' }] });
    }

    if (sql.startsWith('UPDATE contas_pagar SET')) {
      return Promise.resolve({ rows: [{ id: params[params.length - 1], status: 'pendente', valor: params[0] }] });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => {
    jest.clearAllMocks();
});

// marcarComoPaga/cancelar são wiring puro sobre transicionarStatus — a
// mecânica de lock/not-found/status-mismatch já é coberta em
// tests/repositories/shared/transacoes.test.js.
describe('marcarComoPaga', () => {
    test('calls transicionarStatus with the right table, status and sets', async () => {
        transicionarStatus.mockResolvedValue({ id: 1, status: 'pago' });

        const resultado = await contasPagarRepository.marcarComoPaga(1, 9);

        expect(resultado).toEqual({ id: 1, status: 'pago' });
        expect(transicionarStatus).toHaveBeenCalledWith('contas_pagar', 1, 9, {
            statusEsperado: 'pendente',
            mensagemNaoEncontrado: 'Conta a pagar não encontrada',
            mensagemStatusInvalido: 'Somente contas pendentes podem ser marcadas como pagas',
            sets: `status = 'pago', data_pagamento = CURRENT_DATE`
        });
    });
});

describe('cancelar', () => {
    test('calls transicionarStatus with the right table, status and sets', async () => {
        transicionarStatus.mockResolvedValue({ id: 1, status: 'cancelado' });

        const resultado = await contasPagarRepository.cancelar(1, 9);

        expect(resultado).toEqual({ id: 1, status: 'cancelado' });
        expect(transicionarStatus).toHaveBeenCalledWith('contas_pagar', 1, 9, {
            statusEsperado: 'pendente',
            mensagemNaoEncontrado: 'Conta a pagar não encontrada',
            mensagemStatusInvalido: 'Somente contas pendentes podem ser canceladas',
            sets: `status = 'cancelado'`
        });
    });
});

// atualizar usa executarComLock direto (SET dinâmico, não cabe no wrapper
// transicionarStatus) — o teste verifica o wiring (tabela/coluna) e a
// ramificação própria da callback (404/409/SET dinâmico), sem fakear SQL de
// BEGIN/COMMIT/ROLLBACK: isso já é responsabilidade de executarComLock.
describe('atualizar', () => {
    function fakeClientComUpdate(retorno) {
        return { query: jest.fn().mockResolvedValue({ rows: [retorno] }) };
    }

    test('wires executarComLock with contas_pagar/id and updates only the informed fields', async () => {
        const client = fakeClientComUpdate({ id: 1, valor: 200 });
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback({ id: 1, status: 'pendente' }, client)
        );

        const resultado = await contasPagarRepository.atualizar(1, { valor: 200 }, 9);

        expect(resultado).toEqual({ id: 1, valor: 200 });
        expect(executarComLock).toHaveBeenCalledWith('contas_pagar', { coluna: 'id', valor: 1 }, 9, undefined, expect.any(Function));

        const [sql, valores] = client.query.mock.calls[0];
        expect(sql).toContain('UPDATE contas_pagar SET');
        expect(sql).toContain('valor = $1');
        expect(valores).toEqual([200, 1]);
    });

    test('throws 404 when the conta does not exist, without touching the client', async () => {
        const client = fakeClientComUpdate({});
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback(null, client)
        );

        await expect(contasPagarRepository.atualizar(999, { valor: 200 }, 9)).rejects.toMatchObject({
            statusCode: 404,
            message: 'Conta a pagar não encontrada'
        });
        expect(client.query).not.toHaveBeenCalled();
    });

    test('throws 409 when the conta is already paga or cancelada, without updating', async () => {
        const client = fakeClientComUpdate({});
        executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
            callback({ id: 1, status: 'pago' }, client)
        );

        await expect(contasPagarRepository.atualizar(1, { valor: 200 }, 9)).rejects.toMatchObject({
            statusCode: 409,
            message: 'Contas pagas ou canceladas não podem ser editadas'
        });
        expect(client.query).not.toHaveBeenCalled();
    });
});

describe('listarPaginado', () => {
    test('filters by empresa_id even when no other filter is provided', async () => {
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 1 }] })
            .mockResolvedValueOnce({ rows: [{ count: '1' }] });

        const resultado = await contasPagarRepository.listarPaginado({ limit: 20, offset: 0, empresa_id: 9 });

        expect(resultado).toEqual({ items: [{ id: 1 }], total: 1 });
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('WHERE empresa_id = $1');
        expect(params).toEqual([9, 20, 0]);
    });

    test('applies a status filter alongside empresa_id', async () => {
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ count: '0' }] });

        await contasPagarRepository.listarPaginado({ limit: 20, offset: 0, status: 'pendente', empresa_id: 9 });

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

        await contasPagarRepository.listarPaginado({ limit: 20, offset: 0, vencimentoDe: de, vencimentoAte: ate, empresa_id: 9 });

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('empresa_id = $1');
        expect(sql).toContain('data_vencimento >= $2');
        expect(sql).toContain('data_vencimento <= $3');
        expect(params).toEqual([9, de, ate, 20, 0]);
    });
});

describe('criar', () => {
  test('runs as a standalone statement (no BEGIN/COMMIT) when no clienteExterno is given', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, descricao: 'Compra #1', fornecedor: 'Metais & Cia', valor: 100, compra_id: 3, status: 'pendente' }]
    });

    const resultado = await contasPagarRepository.criar({
      descricao: 'Compra #1', fornecedor: 'Metais & Cia', valor: 100, data_vencimento: '2026-09-10',
      usuario_id: 2, empresa_id: 9, compra_id: 3
    });

    expect(resultado.compra_id).toBe(3);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO contas_pagar');
    expect(params).toEqual(['Compra #1', 'Metais & Cia', 100, '2026-09-10', null, null, 2, 9, 3]);
  });

  test('reuses an external client without managing the transaction', async () => {
    const fakeClient = makeFakeClient();

    const resultado = await contasPagarRepository.criar({
      descricao: 'Compra #1', fornecedor: 'Metais & Cia', valor: 100, data_vencimento: '2026-09-10',
      usuario_id: 2, empresa_id: 9, compra_id: 3
    }, fakeClient);

    expect(resultado.compra_id).toBe(3);
    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).not.toContain('BEGIN');
    expect(sqlChamados).not.toContain('COMMIT');
    expect(fakeClient.release).not.toHaveBeenCalled();
  });

  test('defaults compra_id to null for a manual lançamento (no compra behind it)', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, compra_id: null, status: 'pendente' }] });

    await contasPagarRepository.criar({
      descricao: 'Aluguel', valor: 100, data_vencimento: '2026-09-10', usuario_id: 2, empresa_id: 9
    });

    const [, params] = db.query.mock.calls[0];
    expect(params[params.length - 1]).toBeNull();
  });
});

describe('cancelarPorCompraId', () => {
  test('cancels a pendente conta linked to the compra', async () => {
    const fakeClient = makeFakeClient({ contaPorCompra: { id: 5, status: 'pendente' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasPagarRepository.cancelarPorCompraId(1, 9);

    expect(resultado.status).toBe('cancelado');
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('throws 409 and rolls back when the conta is already paga', async () => {
    const fakeClient = makeFakeClient({ contaPorCompra: { id: 5, status: 'pago' } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(contasPagarRepository.cancelarPorCompraId(1, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Compra com conta a pagar já paga não pode ser cancelada'
    });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados.some((sql) => sql.includes("SET status = 'cancelado'"))).toBe(false);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
  });

  test('is a no-op when the compra has no linked conta (à vista compra)', async () => {
    const fakeClient = makeFakeClient({ contaPorCompra: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const resultado = await contasPagarRepository.cancelarPorCompraId(1, 9);

    expect(resultado).toBeNull();
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('reuses an external client without managing the transaction', async () => {
    const fakeClient = makeFakeClient({ contaPorCompra: { id: 5, status: 'pendente' } });

    await contasPagarRepository.cancelarPorCompraId(1, 9, fakeClient);

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).not.toContain('BEGIN');
    expect(sqlChamados).not.toContain('COMMIT');
    expect(fakeClient.release).not.toHaveBeenCalled();
  });

  test('propagates the 409 without touching the transaction when reusing an external client', async () => {
    const fakeClient = makeFakeClient({ contaPorCompra: { id: 5, status: 'pago' } });

    await expect(contasPagarRepository.cancelarPorCompraId(1, 9, fakeClient)).rejects.toMatchObject({ statusCode: 409 });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).not.toContain('BEGIN');
    expect(sqlChamados).not.toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
    expect(fakeClient.release).not.toHaveBeenCalled();
  });
});
