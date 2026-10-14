jest.mock('../../src/config/db');
jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/repositories/precosRepository');
jest.mock('../../src/repositories/contasReceberRepository');
jest.mock('../../src/repositories/taxasPlataformaRepository');
jest.mock('../../src/repositories/pagamentosVendaRepository');
jest.mock('../../src/repositories/parcelasPagamentoRepository');
jest.mock('../../src/repositories/shared/transacoes');

const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');
const precosRepository = require('../../src/repositories/precosRepository');
const contasReceberRepository = require('../../src/repositories/contasReceberRepository');
const taxasPlataformaRepository = require('../../src/repositories/taxasPlataformaRepository');
const pagamentosVendaRepository = require('../../src/repositories/pagamentosVendaRepository');
const parcelasPagamentoRepository = require('../../src/repositories/parcelasPagamentoRepository');
const { executarComLock } = require('../../src/repositories/shared/transacoes');
const AppError = require('../../src/errors/AppError');
const vendasRepository = require('../../src/repositories/vendasRepository');

// Taxa interna da plataforma (VERTUMNO/GiroOne): gerada UMA vez por venda, na
// mesma transação, sobre vendas.total já final. O cálculo/SQL em si é coberto em
// tests/repositories/taxasPlataformaRepository.test.js e tests/utils/taxaPlataforma.test.js;
// aqui só o wiring dentro da transação da venda (criar/cancelar).

function makeFakeClient() {
  const client = { query: jest.fn(), release: jest.fn() };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({});

    if (sql.includes('INSERT INTO vendas')) {
      return Promise.resolve({
        rows: [{ id: 1, cliente_id: params[0], canal_id: params[1], usuario_id: params[2], empresa_id: params[3], total: '0.00', status: 'finalizada' }]
      });
    }

    if (sql.includes('SELECT id, ativo FROM produtos')) {
      return Promise.resolve({ rows: [{ id: params[0], ativo: true }] });
    }

    if (sql.includes('INSERT INTO itens_venda')) {
      const itens = [];
      for (let i = 0; i < params.length; i += 7) {
        itens.push({ id: itens.length + 1, venda_id: params[i], produto_id: params[i + 1], quantidade: params[i + 2], preco_unitario: params[i + 3], custo_unitario: params[i + 4], kit_id: params[i + 6] });
      }
      return Promise.resolve({ rows: itens });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

function prepararVenda({ preco = '10.00', custo = '4.00' } = {}) {
  const fakeClient = makeFakeClient();
  db.connect = jest.fn().mockResolvedValue(fakeClient);
  precosRepository.buscarPrecoVigente.mockResolvedValue({ preco_venda: preco });
  estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 }, custo });
  return fakeClient;
}

const sqls = (client) => client.query.mock.calls.map(([sql]) => sql);

beforeEach(() => {
  // resetAllMocks (não só clear): um mockRejectedValue de um teste não pode
  // vazar para o seguinte.
  jest.resetAllMocks();
  taxasPlataformaRepository.apurar.mockResolvedValue({ id: 77 });
});

describe('criar — taxa interna da plataforma', () => {
  test('apura a taxa UMA vez, no client da transação da venda, sobre o total final (itens - desconto + juros)', async () => {
    const fakeClient = prepararVenda({ preco: '100.00' });

    await vendasRepository.criar({
      canal_id: 1, usuario_id: 2, empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 1 }],
      desconto: 10, juros: 5
    });

    expect(taxasPlataformaRepository.apurar).toHaveBeenCalledTimes(1);
    // 100,00 - 10,00 + 5,00 = 95,00, já incorporado ao total: nada é somado de novo
    expect(taxasPlataformaRepository.apurar).toHaveBeenCalledWith(
      { venda_id: 1, empresa_id: 9, total: 95 },
      fakeClient
    );
    expect(sqls(fakeClient)).toContain('COMMIT');
  });

  test('pagamentos mistos (PIX + Crédito 3x) geram UMA taxa por venda, não uma por pagamento', async () => {
    const fakeClient = prepararVenda({ preco: '10.00' });
    pagamentosVendaRepository.criar.mockImplementation(async ({ forma_pagamento }) => ({ id: forma_pagamento === 'pix' ? 11 : 12 }));
    parcelasPagamentoRepository.criar.mockResolvedValue({ id: 1 });
    parcelasPagamentoRepository.listarPorPagamento.mockResolvedValue([]);

    await vendasRepository.criar({
      canal_id: 1, usuario_id: 2, empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 10 }], // total 100,00
      pagamentos: [
        { forma_pagamento: 'pix', valor: 30, numero_parcelas: 1 },
        { forma_pagamento: 'credito', valor: 70, numero_parcelas: 3 }
      ]
    });

    expect(pagamentosVendaRepository.criar).toHaveBeenCalledTimes(2);
    expect(taxasPlataformaRepository.apurar).toHaveBeenCalledTimes(1);
    expect(taxasPlataformaRepository.apurar).toHaveBeenCalledWith(
      { venda_id: 1, empresa_id: 9, total: 100 },
      fakeClient
    );
  });

  test('a taxa é apurada depois de gravar o total definitivo e ANTES dos pagamentos', async () => {
    const fakeClient = prepararVenda();
    pagamentosVendaRepository.criar.mockResolvedValue({ id: 11 });
    parcelasPagamentoRepository.criar.mockResolvedValue({ id: 1 });
    parcelasPagamentoRepository.listarPorPagamento.mockResolvedValue([]);

    await vendasRepository.criar({
      canal_id: 1, usuario_id: 2, empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 1 }],
      pagamentos: [{ forma_pagamento: 'pix', valor: 10, numero_parcelas: 1 }]
    });

    const indiceTotal = sqls(fakeClient).findIndex((sql) => sql.includes('UPDATE vendas SET subtotal'));
    const ordemTotal = fakeClient.query.mock.invocationCallOrder[indiceTotal];
    const ordemTaxa = taxasPlataformaRepository.apurar.mock.invocationCallOrder[0];
    const ordemPagamento = pagamentosVendaRepository.criar.mock.invocationCallOrder[0];

    expect(indiceTotal).toBeGreaterThan(-1);
    expect(ordemTotal).toBeLessThan(ordemTaxa);
    expect(ordemTaxa).toBeLessThan(ordemPagamento);
  });

  test('o fluxo legado (sem pagamentos[]) também apura a taxa uma vez', async () => {
    prepararVenda();

    await vendasRepository.criar({
      canal_id: 1, usuario_id: 2, empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 1 }]
    });

    expect(taxasPlataformaRepository.apurar).toHaveBeenCalledTimes(1);
  });

  test('falha ao apurar (ex.: sem política vigente) faz ROLLBACK da venda inteira: sem COMMIT, sem pagamento', async () => {
    const fakeClient = prepararVenda();
    taxasPlataformaRepository.apurar.mockRejectedValue(new AppError('Nenhuma política de taxa da plataforma vigente', 500));

    await expect(
      vendasRepository.criar({
        canal_id: 1, usuario_id: 2, empresa_id: 9,
        itens: [{ produto_id: 1, quantidade: 1 }],
        pagamentos: [{ forma_pagamento: 'pix', valor: 10, numero_parcelas: 1 }]
      })
    ).rejects.toMatchObject({ statusCode: 500 });

    expect(sqls(fakeClient)).toContain('ROLLBACK');
    expect(sqls(fakeClient)).not.toContain('COMMIT');
    expect(pagamentosVendaRepository.criar).not.toHaveBeenCalled();
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('erro inesperado ao apurar (banco) também faz ROLLBACK: nunca conclui a venda sem taxa', async () => {
    const fakeClient = prepararVenda();
    taxasPlataformaRepository.apurar.mockRejectedValue(new Error('connection terminated'));

    await expect(
      vendasRepository.criar({
        canal_id: 1, usuario_id: 2, empresa_id: 9,
        itens: [{ produto_id: 1, quantidade: 1 }]
      })
    ).rejects.toThrow('connection terminated');

    expect(sqls(fakeClient)).toContain('ROLLBACK');
    expect(sqls(fakeClient)).not.toContain('COMMIT');
  });

  test('a resposta de criar nunca expõe a taxa interna', async () => {
    prepararVenda();
    taxasPlataformaRepository.apurar.mockResolvedValue({ id: 77, valor: '0.15' });

    const resultado = await vendasRepository.criar({
      canal_id: 1, usuario_id: 2, empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 1 }]
    });

    expect(JSON.stringify(resultado)).not.toMatch(/taxa/i);
  });
});

describe('cancelar — taxa interna da plataforma', () => {
  function clienteDeCancelamento() {
    const client = { query: jest.fn() };
    client.query.mockImplementation((sql, params = []) => {
      if (sql.includes("UPDATE vendas SET status = 'cancelada'")) {
        return Promise.resolve({ rows: [{ id: params[0], status: 'cancelada' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    return client;
  }

  test('estorna a taxa (nunca apaga) no MESMO client da transação travada', async () => {
    const client = clienteDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );

    await vendasRepository.cancelar(1, 9, 5);

    expect(taxasPlataformaRepository.estornarPorVendaId).toHaveBeenCalledTimes(1);
    expect(taxasPlataformaRepository.estornarPorVendaId).toHaveBeenCalledWith(1, 5, client);
  });

  test('cancelamento bloqueado (conta a receber já recebida) não estorna a taxa', async () => {
    const client = clienteDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );
    contasReceberRepository.cancelarPorVendaId.mockRejectedValue(
      new AppError('Venda com conta a receber já recebida não pode ser cancelada', 409)
    );

    await expect(vendasRepository.cancelar(1, 9, 5)).rejects.toMatchObject({ statusCode: 409 });

    expect(taxasPlataformaRepository.estornarPorVendaId).not.toHaveBeenCalled();
  });

  test('falha ao estornar a taxa aborta o cancelamento antes de mexer em estoque ou status', async () => {
    const client = clienteDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );
    taxasPlataformaRepository.estornarPorVendaId.mockRejectedValue(new Error('falha'));

    await expect(vendasRepository.cancelar(1, 9, 5)).rejects.toThrow('falha');

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
    expect(sqls(client).some((sql) => sql.includes("UPDATE vendas SET status = 'cancelada'"))).toBe(false);
  });
});
