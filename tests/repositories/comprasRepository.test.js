jest.mock('../../src/config/db');
jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/repositories/contasPagarRepository');

const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');
const contasPagarRepository = require('../../src/repositories/contasPagarRepository');
const comprasRepository = require('../../src/repositories/comprasRepository');
const AppError = require('../../src/errors/AppError');

function makeFakeClient({ fornecedor = {}, produtos = {}, compra = {} } = {}) {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return Promise.resolve({});
    }

    if (sql.includes('SELECT id, nome FROM fornecedores WHERE id = $1 AND empresa_id = $2')) {
      return Promise.resolve({ rows: fornecedor.existe === false ? [] : [{ id: params[0], nome: fornecedor.nome ?? 'Metais & Cia' }] });
    }

    if (sql.includes('INSERT INTO compras')) {
      return Promise.resolve({
        rows: [{
          id: 1, empresa_id: params[0], fornecedor_id: params[1], data_compra: params[2],
          nota_fiscal: params[3], forma_pagamento: params[4], dias_prazo: params[5],
          status: 'recebido', valor_total: '0.00'
        }]
      });
    }

    if (sql.includes('SELECT id, ativo FROM produtos')) {
      const produtoId = params[0];
      const produto = produtos[produtoId];
      return Promise.resolve({ rows: produto ? [{ id: produtoId, ativo: produto.ativo }] : [] });
    }

    if (sql.includes('UPDATE compras SET valor_total')) {
      return Promise.resolve({});
    }

    if (sql.includes('INSERT INTO itens_compra')) {
      const itens = [];
      for (let i = 0; i < params.length; i += 5) {
        itens.push({ id: itens.length + 1, compra_id: params[i], produto_id: params[i + 1], quantidade: params[i + 2], custo_unitario: params[i + 3] });
      }
      return Promise.resolve({ rows: itens });
    }

    if (sql.includes('SELECT * FROM compras WHERE id = $1 AND empresa_id = $2 FOR UPDATE')) {
      return Promise.resolve({ rows: compra.existe === false ? [] : [{ id: params[0], status: compra.status ?? 'recebido' }] });
    }

    if (sql.includes('SELECT produto_id, quantidade FROM itens_compra')) {
      return Promise.resolve({ rows: compra.itens ?? [] });
    }

    if (sql.includes("UPDATE compras SET status = 'cancelado'")) {
      return Promise.resolve({ rows: [{ id: params[0], status: 'cancelado' }] });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('criar', () => {
  test('computes valor_total from quantidade * custo_unitario and creates a stock entrada per item', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true }, 2: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

    const resultado = await comprasRepository.criar({
      fornecedor_id: 3,
      data_compra: '2026-08-10',
      usuario_id: 2,
      empresa_id: 9,
      itens: [
        { produto_id: 1, quantidade: 3, custo_unitario: 10 },
        { produto_id: 2, quantidade: 2, custo_unitario: 5.5 }
      ]
    });

    expect(resultado.valor_total).toBe(41); // 3*10 + 2*5.5
    expect(resultado.itens).toHaveLength(2);

    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      expect.objectContaining({ produto_id: 1, tipo: 'entrada', quantidade: 3, empresa_id: 9 }),
      fakeClient
    );
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back and creates nothing when the fornecedor does not belong to the empresa', async () => {
    const fakeClient = makeFakeClient({ fornecedor: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(
      comprasRepository.criar({
        fornecedor_id: 999, data_compra: '2026-08-10', usuario_id: 2, empresa_id: 9,
        itens: [{ produto_id: 1, quantidade: 1, custo_unitario: 10 }]
      })
    ).rejects.toMatchObject({ statusCode: 404, message: 'Fornecedor não encontrado' });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados.some((sql) => sql.includes('INSERT INTO compras'))).toBe(false);
    expect(sqlChamados).toContain('ROLLBACK');
  });

  test('rolls back when a produto does not belong to the empresa', async () => {
    const fakeClient = makeFakeClient({ produtos: {} });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(
      comprasRepository.criar({
        fornecedor_id: 3, data_compra: '2026-08-10', usuario_id: 2, empresa_id: 9,
        itens: [{ produto_id: 999, quantidade: 1, custo_unitario: 10 }]
      })
    ).rejects.toMatchObject({ statusCode: 404, message: 'Produto não encontrado' });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
    expect(fakeClient.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
  });

  test('rolls back when a produto is inactive, without touching estoque', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: false } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(
      comprasRepository.criar({
        fornecedor_id: 3, data_compra: '2026-08-10', usuario_id: 2, empresa_id: 9,
        itens: [{ produto_id: 1, quantidade: 1, custo_unitario: 10 }]
      })
    ).rejects.toMatchObject({ statusCode: 400, message: 'Produto inativo não pode receber movimentações de estoque' });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
    expect(fakeClient.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
  });

  test('creates a linked conta a pagar, named after the fornecedor, when forma_pagamento is prazo', async () => {
    const fakeClient = makeFakeClient({ fornecedor: { nome: 'Metais & Cia' }, produtos: { 1: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });
    contasPagarRepository.criar.mockResolvedValue({ id: 1, compra_id: 1, valor: '10.00', status: 'pendente' });

    const resultado = await comprasRepository.criar({
      fornecedor_id: 3, data_compra: '2026-08-10', forma_pagamento: 'prazo', dias_prazo: 30,
      usuario_id: 2, empresa_id: 9, itens: [{ produto_id: 1, quantidade: 1, custo_unitario: 10 }]
    });

    expect(contasPagarRepository.criar).toHaveBeenCalledWith(
      expect.objectContaining({
        descricao: 'Compra #1',
        fornecedor: 'Metais & Cia',
        valor: 10,
        empresa_id: 9,
        compra_id: 1,
        data_vencimento: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
      }),
      fakeClient
    );
    expect(resultado.conta_pagar).toEqual({ id: 1, compra_id: 1, valor: '10.00', status: 'pendente' });
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('does not create a conta a pagar for an à vista (default) compra', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

    const resultado = await comprasRepository.criar({
      fornecedor_id: 3, data_compra: '2026-08-10', usuario_id: 2, empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 1, custo_unitario: 10 }]
    });

    expect(contasPagarRepository.criar).not.toHaveBeenCalled();
    expect(resultado.conta_pagar).toBeNull();
  });
});

describe('cancelar', () => {
  test('reverses stock for every item (saida, motivo cancelamento_compra) and marks the compra cancelada', async () => {
    const fakeClient = makeFakeClient({
      compra: { status: 'recebido', itens: [{ produto_id: 1, quantidade: 3 }, { produto_id: 2, quantidade: 1 }] }
    });
    db.connect = jest.fn().mockResolvedValue(fakeClient);
    contasPagarRepository.cancelarPorCompraId.mockResolvedValue(null);
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

    const resultado = await comprasRepository.cancelar(1, 9, 5);

    expect(resultado.status).toBe('cancelado');
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      { produto_id: 1, tipo: 'saida', quantidade: 3, motivo: 'cancelamento_compra', usuario_id: 9, empresa_id: 5 },
      fakeClient
    );
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      { produto_id: 2, tipo: 'saida', quantidade: 1, motivo: 'cancelamento_compra', usuario_id: 9, empresa_id: 5 },
      fakeClient
    );
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test('throws 404 when the compra does not exist', async () => {
    const fakeClient = makeFakeClient({ compra: { existe: false } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(comprasRepository.cancelar(999, 9, 5)).rejects.toMatchObject({ statusCode: 404 });
    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('throws 409 when the compra is already cancelada', async () => {
    const fakeClient = makeFakeClient({ compra: { status: 'cancelado', itens: [] } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(comprasRepository.cancelar(1, 9, 5)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Somente compras recebidas podem ser canceladas'
    });
    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('cancels the linked conta a pagar (if any) in the same transaction', async () => {
    const fakeClient = makeFakeClient({ compra: { status: 'recebido', itens: [] } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await comprasRepository.cancelar(1, 9, 5);

    expect(contasPagarRepository.cancelarPorCompraId).toHaveBeenCalledWith(1, 5, fakeClient);
  });

  test('blocks cancellation (409) and rolls back without touching stock or compra status when the linked conta a pagar is already paga', async () => {
    const fakeClient = makeFakeClient({
      compra: { status: 'recebido', itens: [{ produto_id: 1, quantidade: 3 }] }
    });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    contasPagarRepository.cancelarPorCompraId.mockRejectedValue(
      new AppError('Compra com conta a pagar já paga não pode ser cancelada', 409)
    );

    await expect(comprasRepository.cancelar(1, 9, 5)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Compra com conta a pagar já paga não pode ser cancelada'
    });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados.some((sql) => sql.includes("UPDATE compras SET status = 'cancelado'"))).toBe(false);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
  });

  test('blocks cancellation (409) when reversing an item would leave estoque negative', async () => {
    const fakeClient = makeFakeClient({
      compra: { status: 'recebido', itens: [{ produto_id: 1, quantidade: 9999 }] }
    });
    db.connect = jest.fn().mockResolvedValue(fakeClient);
    contasPagarRepository.cancelarPorCompraId.mockResolvedValue(null);
    estoqueRepository.criarMovimentacao.mockResolvedValue({ erro: 'ESTOQUE_INSUFICIENTE' });

    await expect(comprasRepository.cancelar(1, 9, 5)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Estoque insuficiente para estornar esta compra'
    });

    const sqlChamados = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados).toContain('ROLLBACK');
    expect(sqlChamados).not.toContain('COMMIT');
  });
});
