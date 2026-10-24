jest.mock('../../src/config/db');
jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/repositories/precosRepository');
jest.mock('../../src/repositories/contasReceberRepository');
jest.mock('../../src/repositories/taxasPlataformaRepository');
jest.mock('../../src/repositories/comissoesRepository');
jest.mock('../../src/repositories/pagamentosVendaRepository');
jest.mock('../../src/repositories/parcelasPagamentoRepository');
jest.mock('../../src/repositories/cancelamentosRepository');
jest.mock('../../src/repositories/shared/transacoes');

const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');
const precosRepository = require('../../src/repositories/precosRepository');
const contasReceberRepository = require('../../src/repositories/contasReceberRepository');
const cancelamentosRepository = require('../../src/repositories/cancelamentosRepository');
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
      for (let i = 0; i < params.length; i += 8) {
        itens.push({
          id: itens.length + 1, venda_id: params[i], produto_id: params[i + 1], quantidade: params[i + 2],
          preco_unitario: params[i + 3], custo_unitario: params[i + 4], kit_id: params[i + 6]
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

  // Kit é montado do zero a cada venda (sem cadastro prévio): cada componente
  // é só mais uma linha de itens_venda, com kit_id gravado — não existe
  // produto virtual de kit nem tratamento especial de estoque/preço/custo.
  test('records the matching kit_id on every component of a kit and debits stock for each one', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true }, 2: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    precosRepository.buscarPrecoVigente.mockImplementation((produtoId) => {
      if (produtoId === 1) return Promise.resolve({ preco_venda: '10.00' });
      if (produtoId === 2) return Promise.resolve({ preco_venda: '5.00' });
      return Promise.resolve(null);
    });

    estoqueRepository.criarMovimentacao.mockImplementation(({ produto_id }) => {
      if (produto_id === 1) return Promise.resolve({ movimentacao: { id: 1 }, custo: '4.00' });
      return Promise.resolve({ movimentacao: { id: 2 }, custo: '2.00' });
    });

    const resultado = await vendasRepository.criar({
      cliente_id: null,
      canal_id: 1,
      usuario_id: 2,
      empresa_id: 9,
      itens: [
        { produto_id: 1, quantidade: 1, kit_id: 1 },
        { produto_id: 2, quantidade: 1, kit_id: 1 }
      ]
    });

    expect(resultado.total).toBe(15); // 1*10.00 + 1*5.00
    expect(resultado.itens).toHaveLength(2);
    expect(resultado.itens[0].kit_id).toBe(1);
    expect(resultado.itens[1].kit_id).toBe(1);
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      expect.objectContaining({ produto_id: 1, tipo: 'saida', quantidade: 1 }),
      fakeClient
    );
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      expect.objectContaining({ produto_id: 2, tipo: 'saida', quantidade: 1 }),
      fakeClient
    );
  });

  test('keeps distinct kit_ids for two kits alongside a NULL kit_id for an avulso item in the same venda', async () => {
    const fakeClient = makeFakeClient({ produtos: { 1: { ativo: true }, 2: { ativo: true }, 3: { ativo: true } } });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    precosRepository.buscarPrecoVigente.mockResolvedValue({ preco_venda: '10.00' });
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 }, custo: '4.00' });

    const resultado = await vendasRepository.criar({
      cliente_id: null,
      canal_id: 1,
      usuario_id: 2,
      empresa_id: 9,
      itens: [
        { produto_id: 1, quantidade: 1, kit_id: 1 },
        { produto_id: 2, quantidade: 1, kit_id: 1 },
        { produto_id: 1, quantidade: 1, kit_id: 2 },
        { produto_id: 2, quantidade: 1, kit_id: 2 },
        { produto_id: 3, quantidade: 1 }
      ]
    });

    const kitIds = resultado.itens.map((item) => item.kit_id);
    expect(kitIds.filter((kit_id) => kit_id === 1)).toHaveLength(2);
    expect(kitIds.filter((kit_id) => kit_id === 2)).toHaveLength(2);
    expect(kitIds.filter((kit_id) => kit_id == null)).toHaveLength(1);
  });

  test('stores kit_id as NULL when the item carries no kit_id (unchanged behaviour for avulso-only vendas)', async () => {
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

    expect(resultado.itens[0].kit_id).toBeNull();
  });
});

// buscarPorId lê custo_unitario direto de itens_venda, sem join com produtos
// — por isso o valor devolvido é sempre o congelado na venda, nunca
// recalculado a partir de produtos.custo (que pode ter mudado depois).
describe('buscarPorId', () => {
  test('returns custo_unitario as stored on itens_venda, never re-reading produtos.custo', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1, empresa_id: 9, canal: 'loja_fisica', status: 'finalizada', total: '30.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, produto_id: 1, quantidade: 3, preco_unitario: '10.00', custo_unitario: '4.00', kit_id: null }] });

    const resultado = await vendasRepository.buscarPorId(1, 9);

    expect(resultado.itens[0].custo_unitario).toBe('4.00');

    const itensSql = db.query.mock.calls[1][0];
    expect(itensSql).toContain('custo_unitario');
    expect(itensSql).not.toMatch(/produtos|JOIN/i);
  });

  test('returns kit_id alongside each item, for both kit components and avulso items', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1, empresa_id: 9, canal: 'loja_fisica', status: 'finalizada', total: '25.00' }] })
      .mockResolvedValueOnce({ rows: [
        { id: 1, produto_id: 1, quantidade: 1, preco_unitario: '10.00', custo_unitario: '4.00', kit_id: 1 },
        { id: 2, produto_id: 2, quantidade: 1, preco_unitario: '5.00', custo_unitario: '2.00', kit_id: 1 },
        { id: 3, produto_id: 3, quantidade: 1, preco_unitario: '10.00', custo_unitario: '4.00', kit_id: null }
      ] });

    const resultado = await vendasRepository.buscarPorId(1, 9);

    expect(resultado.itens.map((item) => item.kit_id)).toEqual([1, 1, null]);

    const itensSql = db.query.mock.calls[1][0];
    expect(itensSql).toContain('kit_id');
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
  const OPCOES = { motivo: 'Cliente desistiu da compra', login: 'vendedor@teste.invalid', faixaAutorizada: 'ate_7_dias' };
  const AUTORIZADOR = { id: 77, login: 'gerente@teste.invalid' };

  beforeEach(() => {
    contasReceberRepository.cancelarPorVendaId.mockReset();
    cancelamentosRepository.buscarIdadeDaVenda.mockResolvedValue({ dias: 2, status: 'finalizada', usuario_id: 9 });
    cancelamentosRepository.inserir.mockImplementation(async (dados) => ({ id: 1, ...dados }));
  });

  function fakeClientDeCancelamento({ itens = [] } = {}) {
    const client = { query: jest.fn() };
    client.query.mockImplementation((sql, params = []) => {
      if (sql.includes('SELECT produto_id, quantidade, local_id FROM itens_venda')) {
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
    const client = fakeClientDeCancelamento({ itens: [{ produto_id: 1, quantidade: 3, local_id: 7 }, { produto_id: 2, quantidade: 1, local_id: 7 }] });
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 }, custo: '4.00' });

    const resultado = await vendasRepository.cancelar(1, 9, 5, OPCOES);

    expect(executarComLock).toHaveBeenCalledWith('vendas', { coluna: 'id', valor: 1 }, 5, undefined, expect.any(Function));
    expect(resultado.status).toBe('cancelada');
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      { produto_id: 1, tipo: 'entrada', quantidade: 3, motivo: 'cancelamento_venda', usuario_id: 9, empresa_id: 5, local_id: 7 },
      client
    );
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      { produto_id: 2, tipo: 'entrada', quantidade: 1, motivo: 'cancelamento_venda', usuario_id: 9, empresa_id: 5, local_id: 7 },
      client
    );
  });

  // Cancelamento não tem tratamento especial pra kit: a query de estorno já
  // seleciona toda linha de itens_venda da venda (produto_id, quantidade),
  // kit ou avulso, e reverte cada uma normalmente pelo fluxo existente.
  test('reverses stock for every component of a kit on cancellation, same as an avulso item', async () => {
    const client = fakeClientDeCancelamento({ itens: [{ produto_id: 1, quantidade: 2, local_id: 7 }, { produto_id: 2, quantidade: 1, local_id: 7 }] });
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 }, custo: '4.00' });

    const resultado = await vendasRepository.cancelar(1, 9, 5, OPCOES);

    expect(resultado.status).toBe('cancelada');
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledTimes(2);
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      { produto_id: 1, tipo: 'entrada', quantidade: 2, motivo: 'cancelamento_venda', usuario_id: 9, empresa_id: 5, local_id: 7 },
      client
    );
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      { produto_id: 2, tipo: 'entrada', quantidade: 1, motivo: 'cancelamento_venda', usuario_id: 9, empresa_id: 5, local_id: 7 },
      client
    );
  });

  test('throws 404 when the venda does not exist, without touching stock', async () => {
    const client = fakeClientDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback(null, client)
    );

    await expect(vendasRepository.cancelar(999, 9, 5, OPCOES)).rejects.toMatchObject({ statusCode: 404, message: 'Venda não encontrada' });
    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('throws 409 when the venda is not finalizada, without touching stock', async () => {
    const client = fakeClientDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'cancelada' }, client)
    );

    await expect(vendasRepository.cancelar(1, 9, 5, OPCOES)).rejects.toMatchObject({
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

    await vendasRepository.cancelar(1, 9, 5, OPCOES);

    expect(contasReceberRepository.cancelarPorVendaId).toHaveBeenCalledWith(1, 5, client);
  });

  test('blocks cancellation (409) without touching stock or venda status when the linked conta a receber is already recebida', async () => {
    const client = fakeClientDeCancelamento({ itens: [{ produto_id: 1, quantidade: 3, local_id: 7 }] });
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );

    const AppError = require('../../src/errors/AppError');
    contasReceberRepository.cancelarPorVendaId.mockRejectedValue(
      new AppError('Venda com conta a receber já recebida não pode ser cancelada', 409)
    );

    await expect(vendasRepository.cancelar(1, 9, 5, OPCOES)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Venda com conta a receber já recebida não pode ser cancelada'
    });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
    const sqlChamados = client.query.mock.calls.map(([sql]) => sql);
    expect(sqlChamados.some((sql) => sql.includes("UPDATE vendas SET status = 'cancelada'"))).toBe(false);
  });

  describe('política de cancelamento', () => {
    const vendaFinalizada = { id: 1, status: 'finalizada', usuario_id: 9, forma_pagamento: 'a_vista', total: '120.00' };

    function comVenda(venda, client) {
      executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) => callback(venda, client));
    }

    test('exige a política (motivo, login e faixa): sem ela nem abre a transação', async () => {
      await expect(vendasRepository.cancelar(1, 9, 5)).rejects.toThrow('política de cancelamento');
      await expect(vendasRepository.cancelar(1, 9, 5, { ...OPCOES, motivo: '' })).rejects.toThrow('política de cancelamento');
      await expect(vendasRepository.cancelar(1, 9, 5, { ...OPCOES, faixaAutorizada: 'qualquer' })).rejects.toThrow('política de cancelamento');
      expect(executarComLock).not.toHaveBeenCalled();
    });

    test('grava o registro com quantidade devolvida, valor, faixa, dias, motivo e login; filtra UPDATE e itens por empresa_id', async () => {
      const client = fakeClientDeCancelamento({ itens: [{ produto_id: 1, quantidade: 3, local_id: 7 }, { produto_id: 2, quantidade: 1, local_id: 7 }] });
      comVenda(vendaFinalizada, client);
      estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 }, custo: '4.00' });

      const resultado = await vendasRepository.cancelar(1, 9, 5, OPCOES);

      expect(cancelamentosRepository.inserir).toHaveBeenCalledWith({
        empresa_id: 5, venda_id: 1, motivo: 'Cliente desistiu da compra',
        cancelado_por: 9, cancelado_por_login: 'vendedor@teste.invalid',
        autorizado_por: null, autorizado_por_login: null,
        faixa_aplicada: 'ate_7_dias', dias_da_venda: 2,
        quantidade_devolvida: 4, valor_devolvido: 120
      }, client);
      expect(resultado.cancelamento).toMatchObject({ id: 1, quantidade_devolvida: 4 });

      const chamadas = client.query.mock.calls;
      const update = chamadas.find(([sql]) => sql.includes("UPDATE vendas SET status = 'cancelada'"));
      expect(update[0]).toContain('AND empresa_id = $2');
      expect(update[1]).toEqual([1, 5]);
      const itens = chamadas.find(([sql]) => sql.includes('FROM itens_venda'));
      expect(itens[0]).toContain('empresa_id = $2');
      expect(itens[1]).toEqual([1, 5]);
    });

    test('registra o autorizador quando a faixa exige', async () => {
      const client = fakeClientDeCancelamento();
      comVenda(vendaFinalizada, client);
      cancelamentosRepository.buscarIdadeDaVenda.mockResolvedValue({ dias: 12 });

      await vendasRepository.cancelar(1, 9, 5, { ...OPCOES, faixaAutorizada: '8_a_30_dias', autorizador: AUTORIZADOR });

      expect(cancelamentosRepository.inserir).toHaveBeenCalledWith(expect.objectContaining({
        faixa_aplicada: '8_a_30_dias', dias_da_venda: 12, autorizado_por: 77, autorizado_por_login: 'gerente@teste.invalid'
      }), client);
    });

    test('faixa que exige autorização sem autorizador é recusada (403) sem mexer em nada', async () => {
      const client = fakeClientDeCancelamento();
      comVenda(vendaFinalizada, client);
      cancelamentosRepository.buscarIdadeDaVenda.mockResolvedValue({ dias: 12 });

      await expect(vendasRepository.cancelar(1, 9, 5, { ...OPCOES, faixaAutorizada: '8_a_30_dias' }))
        .rejects.toMatchObject({ statusCode: 403 });

      expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
      expect(cancelamentosRepository.inserir).not.toHaveBeenCalled();
    });

    test('se a venda mudou para uma faixa mais exigente durante a autorização, recusa (409)', async () => {
      const client = fakeClientDeCancelamento();
      comVenda(vendaFinalizada, client);
      cancelamentosRepository.buscarIdadeDaVenda.mockResolvedValue({ dias: 31 });

      await expect(vendasRepository.cancelar(1, 9, 5, { ...OPCOES, faixaAutorizada: '8_a_30_dias', autorizador: AUTORIZADOR }))
        .rejects.toMatchObject({ statusCode: 409 });

      expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
      expect(cancelamentosRepository.inserir).not.toHaveBeenCalled();
    });

    test('quem só vê as próprias vendas não cancela a de outro usuário (404, sem tocar em estoque)', async () => {
      const client = fakeClientDeCancelamento();
      comVenda({ ...vendaFinalizada, usuario_id: 10 }, client);

      await expect(vendasRepository.cancelar(1, 9, 5, { ...OPCOES, restringirAoUsuarioId: 9 }))
        .rejects.toMatchObject({ statusCode: 404 });

      expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
      expect(cancelamentosRepository.inserir).not.toHaveBeenCalled();
    });

    test('valor devolvido = soma dos estornos gerados; venda a prazo sem pagamentos devolve 0', async () => {
      const estornosPagamentoRepository = require('../../src/repositories/estornosPagamentoRepository');
      const spy = jest.spyOn(estornosPagamentoRepository, 'criar').mockResolvedValue({ id: 1 });
      const client = { query: jest.fn() };
      client.query.mockImplementation((sql) => {
        if (sql.includes('SELECT * FROM pagamentos_venda')) {
          return Promise.resolve({ rows: [{ id: 1, valor: '80.00', status: 'confirmado' }, { id: 2, valor: '40.00', status: 'confirmado' }] });
        }
        if (sql.includes('SUM(valor)')) return Promise.resolve({ rows: [{ total_estornado: '0' }] });
        if (sql.includes("UPDATE vendas SET status = 'cancelada'")) return Promise.resolve({ rows: [{ id: 1, status: 'cancelada' }] });
        return Promise.resolve({ rows: [] });
      });
      comVenda(vendaFinalizada, client);

      await vendasRepository.cancelar(1, 9, 5, OPCOES);
      expect(cancelamentosRepository.inserir).toHaveBeenLastCalledWith(expect.objectContaining({ valor_devolvido: 120 }), client);

      comVenda({ ...vendaFinalizada, forma_pagamento: 'prazo' }, fakeClientDeCancelamento());
      await vendasRepository.cancelar(1, 9, 5, OPCOES);
      expect(cancelamentosRepository.inserir).toHaveBeenLastCalledWith(expect.objectContaining({ valor_devolvido: 0 }), expect.anything());

      spy.mockRestore();
    });
  });
});
