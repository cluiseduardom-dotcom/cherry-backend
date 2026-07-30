jest.mock('../../src/config/db');
jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/repositories/precosRepository');
jest.mock('../../src/repositories/contasReceberRepository');

const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');
const precosRepository = require('../../src/repositories/precosRepository');
const contasReceberRepository = require('../../src/repositories/contasReceberRepository');
const vendasRepository = require('../../src/repositories/vendasRepository');

function makeFakeClient({ produtos = {}, venda = {}, clienteExiste = true } = {}) {
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
      for (let i = 0; i < params.length; i += 5) {
        itens.push({ id: itens.length + 1, venda_id: params[i], produto_id: params[i + 1], quantidade: params[i + 2], preco_unitario: params[i + 3] });
      }
      return Promise.resolve({ rows: itens });
    }

    if (sql.includes('SELECT * FROM vendas WHERE id = $1 AND empresa_id = $2 FOR UPDATE')) {
      return Promise.resolve({ rows: venda.existe === false ? [] : [{ id: params[0], status: venda.status ?? 'finalizada' }] });
    }

    if (sql.includes('SELECT produto_id, quantidade FROM itens_venda')) {
      return Promise.resolve({ rows: venda.itens ?? [] });
    }

    if (sql.includes("UPDATE vendas SET status = 'cancelada'")) {
      return Promise.resolve({ rows: [{ id: params[0], status: 'cancelada' }] });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('criar', () => {
  test('locks in the preço vigente at creation time for each item and computes the total', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true }, 2: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    precosRepository.buscarPrecoVigente.mockImplementation((produtoId) => {
      if (produtoId === 1) return Promise.resolve({ preco_venda: '10.00' });
      if (produtoId === 2) return Promise.resolve({ preco_venda: '5.50' });
      return Promise.resolve(null);
    });

    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

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
      .mockResolvedValueOnce({ movimentacao: { id: 1 } })
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
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });
    contasReceberRepository.criar.mockResolvedValue({ id: 1, venda_id: 1, valor: 10, status: 'pendente' });

    const resultado = await vendasRepository.criar({
      cliente_id: null,
      canal_id: 1,
      usuario_id: 2,
      empresa_id: 9,
      forma_pagamento: 'prazo',
      dias_prazo: 30,
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
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

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

describe('cancelar', () => {
  test('reverses stock for every item (entrada, motivo cancelamento_venda) and marks the venda cancelada', async () => {
    const fakeClient = makeFakeClient({
      venda: { status: 'finalizada', itens: [{ produto_id: 1, quantidade: 3 }, { produto_id: 2, quantidade: 1 }] }
    });
    db.connect = jest.fn().mockResolvedValue(fakeClient);
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

    const resultado = await vendasRepository.cancelar(1, 9, 5);

    expect(resultado.status).toBe('cancelada');
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      { produto_id: 1, tipo: 'entrada', quantidade: 3, motivo: 'cancelamento_venda', usuario_id: 9, empresa_id: 5 },
      fakeClient
    );
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      { produto_id: 2, tipo: 'entrada', quantidade: 1, motivo: 'cancelamento_venda', usuario_id: 9, empresa_id: 5 },
      fakeClient
    );
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('throws 404 when the venda does not exist', async () => {
    const fakeClient = makeFakeClient({ venda: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(vendasRepository.cancelar(999, 9, 5)).rejects.toMatchObject({ statusCode: 404 });
    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('throws 409 when the venda is not finalizada', async () => {
    const fakeClient = makeFakeClient({ venda: { status: 'cancelada', itens: [] } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(vendasRepository.cancelar(1, 9, 5)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Somente vendas finalizadas podem ser canceladas'
    });
    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('cancels the linked conta a receber (if any) in the same transaction', async () => {
    const fakeClient = makeFakeClient({ venda: { status: 'finalizada', itens: [] } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await vendasRepository.cancelar(1, 9, 5);

    expect(contasReceberRepository.cancelarPorVendaId).toHaveBeenCalledWith(1, 5, fakeClient);
  });
});
