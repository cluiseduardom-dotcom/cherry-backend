jest.mock('../../src/config/db');
jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/repositories/precosRepository');
jest.mock('../../src/repositories/contasReceberRepository');
jest.mock('../../src/repositories/shared/transacoes');

const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');
const precosRepository = require('../../src/repositories/precosRepository');
const contasReceberRepository = require('../../src/repositories/contasReceberRepository');
const { executarComLock } = require('../../src/repositories/shared/transacoes');
const vendasRepository = require('../../src/repositories/vendasRepository');

function makeFakeClient({ produtos = {}, clienteExiste = true } = {}) {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return Promise.resolve({});
    }

    if (sql.includes('SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2')) {
      return Promise.resolve({ rows: clienteExiste ? [{ id: params[0] }] : [] });
    }

    if (sql.includes('INSERT INTO vendas')) {
      return Promise.resolve({
        rows: [{
          id: 1, cliente_id: params[0], canal_id: params[1], usuario_id: params[2],
          empresa_id: params[3], total: '0.00', status: 'finalizada', data: '2026-01-01T00:00:00.000Z'
        }]
      });
    }

    if (sql.includes('SELECT id, ativo FROM produtos')) {
      const produtoId = params[0];
      const produto = produtos[produtoId];
      return Promise.resolve({ rows: produto ? [{ id: produtoId, ativo: produto.ativo }] : [] });
    }

    if (sql.includes('UPDATE vendas SET total')) {
      return Promise.resolve({});
    }

    if (sql.includes('INSERT INTO itens_venda')) {
      const itens = [];
      for (let i = 0; i < params.length; i += 6) {
        itens.push({
          id: itens.length + 1, venda_id: params[i], produto_id: params[i + 1], quantidade: params[i + 2],
          preco_unitario: params[i + 3], custo_unitario: params[i + 4]
        });
      }
      return Promise.resolve({ rows: itens });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('criar', () => {
  test('locks in the preço vigente and the produto custo (custo_unitario) at creation time for each item, and computes the total', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true }, 2: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    precosRepository.buscarPrecoVigente.mockImplementation((produtoId) => {
      if (produtoId === 1) return Promise.resolve({ preco_venda: '10.00' });
      if (produtoId === 2) return Promise.resolve({ preco_venda: '5.50' });
      return Promise.resolve(null);
    });

    estoqueRepository.criarMovimentacao.mockImplementation(({ produto_id }) => {
      if (produto_id === 1) return Promise.resolve({ movimentacao: { id: 1 }, custo: '4.00' });
      return Promise.resolve({ movimentacao: { id: 2 }, custo: '2.20' });
    });

    const resultado = await vendasRepository.criar({
      cliente_id: 7,
      canal_id: 1,
      usuario_id: 2,
      empresa_id: 9,
      itens: [
        { produto_id: 1, quantidade: 3 },
        { produto_id: 2, quantidade: 2 }
      ]
    });

    expect(resultado.total).toBe(41); // 3*10.00 + 2*5.50
    expect(resultado.itens).toHaveLength(2);
    expect(resultado.itens[0].preco_unitario).toBe(10);
    expect(resultado.itens[1].preco_unitario).toBe(5.5);
    expect(resultado.itens[0].custo_unitario).toBe(4);
    expect(resultado.itens[1].custo_unitario).toBe(2.2);

    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      expect.objectContaining({ produto_id: 1, tipo: 'saida', quantidade: 3, empresa_id: 9 }),
      fakeClient
    );
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back and creates nothing when the cliente does not belong to the empresa', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true } }, clienteExiste: false });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(
      vendasRepository.criar({
        cliente_id: 7,
        canal_id: 1,
        usuario_id: 2,
        empresa_id: 9,
        itens: [{ produto_id: 1, quantidade: 1 }]
      })
    ).rejects.toMatchObject({ statusCode: 404, message: 'Cliente não encontrado' });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados.some((sql) => sql.includes('INSERT INTO vendas'))).toBe(false);
    expect(sqlChamados).toContain('ROLLBACK');
  });

  test('rolls back and creates nothing when an item has insufficient stock', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true }, 2: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    precosRepository.buscarPrecoVigente.mockResolvedValue({ preco_venda: '10.00' });

    estoqueRepository.criarMovimentacao
      .mockResolvedValueOnce({ movimentacao: { id: 1 }, custo: '4.00' })
      .mockResolvedValueOnce({ erro: 'ESTOQUE_INSUFICIENTE' });

    await expect(
      vendasRepository.criar({
        cliente_id: null,
        canal_id: 1,
        usuario_id: 2,
        empresa_id: 9,
        itens: [
          { produto_id: 1, quantidade: 1 },
          { produto_id: 2, quantidade: 9999 }
        ]
      })
    ).rejects.toMatchObject({ statusCode: 409, message: 'Estoque insuficiente para essa venda' });

    // nothing partially created: itens_venda insert never reached, transaction rolled back
    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados.some((sql) => sql.includes('INSERT INTO itens_venda'))).toBe(false);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back when a produto is inactive, without touching estoque', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: false } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(
      vendasRepository.criar({ cliente_id: null, canal_id: 1, usuario_id: 2, empresa_id: 9, itens: [{ produto_id: 1, quantidade: 1 }] })
    ).rejects.toMatchObject({ statusCode: 400, message: 'Produto inativo não pode ser vendido' });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
    expect(fakeClient.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
  });

  test('rolls back when the produto has no preço vigente for the canal', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    precosRepository.buscarPrecoVigente.mockResolvedValue(null);

    await expect(
      vendasRepository.criar({ cliente_id: null, canal_id: 1, usuario_id: 2, empresa_id: 9, itens: [{ produto_id: 1, quantidade: 1 }] })
    ).rejects.toMatchObject({ statusCode: 409, message: 'Produto sem preço definido para o canal informado' });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('creates a linked conta a receber, locked in at the venda total, when forma_pagamento is prazo', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    precosRepository.buscarPrecoVigente.mockResolvedValue({ preco_venda: '10.00' });
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 }, custo: '4.00' });
    contasReceberRepository.criar.mockResolvedValue({ id: 1, venda_id: 1, valor: 10, status: 'pendente' });

    const resultado = await vendasRepository.criar({
      cliente_id: null,
      canal_id: 1,
      usuario_id: 2,
      empresa_id: 9,
      forma_pagamento: 'prazo',
      meses_prazo: 3,
      itens: [{ produto_id: 1, quantidade: 1 }]
    });

    expect(contasReceberRepository.criar).toHaveBeenCalledWith(
      expect.objectContaining({
        venda_id: 1,
        descricao: 'Venda #1',
        valor: 10,
        empresa_id: 9,
        data_vencimento: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
      }),
      fakeClient
    );
    expect(resultado.conta_receber).toEqual({ id: 1, venda_id: 1, valor: 10, status: 'pendente' });
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('does not create a conta a receber for an à vista (default) venda', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    precosRepository.buscarPrecoVigente.mockResolvedValue({ preco_venda: '10.00' });
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 }, custo: '4.00' });

    const resultado = await vendasRepository.criar({
      cliente_id: null,
      canal_id: 1,
      usuario_id: 2,
      empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 1 }]
    });

    expect(contasReceberRepository.criar).not.toHaveBeenCalled();
    expect(resultado.conta_receber).toBeNull();
  });
});

// buscarPorId lê custo_unitario direto de itens_venda, sem join com produtos
// — por isso o valor devolvido é sempre o congelado na venda, nunca
// recalculado a partir de produtos.custo (que pode ter mudado depois).
describe('buscarPorId', () => {
  test('returns custo_unitario as stored on itens_venda, never re-reading produtos.custo', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1, empresa_id: 9, canal: 'loja_fisica', status: 'finalizada', total: '30.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, produto_id: 1, quantidade: 3, preco_unitario: '10.00', custo_unitario: '4.00' }] });

    const resultado = await vendasRepository.buscarPorId(1, 9);

    expect(resultado.itens[0].custo_unitario).toBe('4.00');

    const itensSql = db.query.mock.calls[1][0];
    expect(itensSql).toContain('custo_unitario');
    expect(itensSql).not.toMatch(/produtos|JOIN/i);
  });

  test('returns null when the venda does not exist', async () => {
    db.query = jest.fn().mockResolvedValueOnce({ rows: [] });

    const resultado = await vendasRepository.buscarPorId(999, 9);

    expect(resultado).toBeNull();
  });
});

// cancelar usa executarComLock direto (efeitos colaterais entre o lock e a
// escrita final: contasReceberRepository, estoque) — mecânica de
// lock/commit/rollback já coberta em tests/repositories/shared/transacoes.test.js.
// Aqui só o wiring e a ramificação própria da callback.
describe('cancelar', () => {
  function fakeClientDeCancelamento({ itens = [] } = {}) {
    const client = { query: jest.fn() };
    client.query.mockImplementation((sql, params = []) => {
      if (sql.includes('SELECT produto_id, quantidade FROM itens_venda')) {
        return Promise.resolve({ rows: itens });
      }
      if (sql.includes("UPDATE vendas SET status = 'cancelada'")) {
        return Promise.resolve({ rows: [{ id: params[0], status: 'cancelada' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    return client;
  }

  test('wires executarComLock with vendas/id, reverses stock for every item and marks the venda cancelada', async () => {
    const client = fakeClientDeCancelamento({ itens: [{ produto_id: 1, quantidade: 3 }, { produto_id: 2, quantidade: 1 }] });
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 }, custo: '4.00' });

    const resultado = await vendasRepository.cancelar(1, 9, 5);

    expect(executarComLock).toHaveBeenCalledWith('vendas', { coluna: 'id', valor: 1 }, 5, undefined, expect.any(Function));
    expect(resultado.status).toBe('cancelada');
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      { produto_id: 1, tipo: 'entrada', quantidade: 3, motivo: 'cancelamento_venda', usuario_id: 9, empresa_id: 5 },
      client
    );
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      { produto_id: 2, tipo: 'entrada', quantidade: 1, motivo: 'cancelamento_venda', usuario_id: 9, empresa_id: 5 },
      client
    );
  });

  test('throws 404 when the venda does not exist, without touching stock', async () => {
    const client = fakeClientDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback(null, client)
    );

    await expect(vendasRepository.cancelar(999, 9, 5)).rejects.toMatchObject({ statusCode: 404, message: 'Venda não encontrada' });
    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('throws 409 when the venda is not finalizada, without touching stock', async () => {
    const client = fakeClientDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'cancelada' }, client)
    );

    await expect(vendasRepository.cancelar(1, 9, 5)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Somente vendas finalizadas podem ser canceladas'
    });
    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('cancels the linked conta a receber (if any), reusing the same locked client', async () => {
    const client = fakeClientDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );

    await vendasRepository.cancelar(1, 9, 5);

    expect(contasReceberRepository.cancelarPorVendaId).toHaveBeenCalledWith(1, 5, client);
  });

  test('blocks cancellation (409) without touching stock or venda status when the linked conta a receber is already recebida', async () => {
    const client = fakeClientDeCancelamento({ itens: [{ produto_id: 1, quantidade: 3 }] });
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );

    const AppError = require('../../src/errors/AppError');
    contasReceberRepository.cancelarPorVendaId.mockRejectedValue(
      new AppError('Venda com conta a receber já recebida não pode ser cancelada', 409)
    );

    await expect(vendasRepository.cancelar(1, 9, 5)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Venda com conta a receber já recebida não pode ser cancelada'
    });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
    const sqlChamados = client.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados.some((sql) => sql.includes("UPDATE vendas SET status = 'cancelada'"))).toBe(false);
  });
});
