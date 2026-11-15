jest.mock('../../src/config/db');
jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/repositories/precosRepository');
jest.mock('../../src/repositories/contasReceberRepository');
jest.mock('../../src/repositories/taxasPlataformaRepository');
jest.mock('../../src/repositories/cobrancaTaxaRepository');
jest.mock('../../src/repositories/bloqueiosPixRepository');
jest.mock('../../src/repositories/comissoesRepository');
jest.mock('../../src/repositories/pagamentosVendaRepository');
jest.mock('../../src/repositories/parcelasPagamentoRepository');
jest.mock('../../src/repositories/cobrancasPagamentoRepository');
jest.mock('../../src/repositories/cancelamentosRepository');
jest.mock('../../src/repositories/shared/transacoes');

const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');
const precosRepository = require('../../src/repositories/precosRepository');
const taxasPlataformaRepository = require('../../src/repositories/taxasPlataformaRepository');
const bloqueiosPixRepository = require('../../src/repositories/bloqueiosPixRepository');
const pagamentosVendaRepository = require('../../src/repositories/pagamentosVendaRepository');
const parcelasPagamentoRepository = require('../../src/repositories/parcelasPagamentoRepository');
const cobrancasPagamentoRepository = require('../../src/repositories/cobrancasPagamentoRepository');
const vendasRepository = require('../../src/repositories/vendasRepository');

// Bloqueio de Pix manual da empresa (decisão do operador da plataforma): a venda recusa SÓ o Pix lançado à mão, no
// início da transação. O comportamento ponta a ponta está em tests/routes/painelPixManual.integration.test.js; aqui só
// o encaixe: quando consulta o bloqueio, quando não consulta e que recusa antes de criar venda ou mexer no estoque.

function makeFakeClient() {
  const client = { query: jest.fn(), release: jest.fn() };
  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({});
    if (sql.includes('INSERT INTO vendas')) {
      return Promise.resolve({ rows: [{ id: 1, canal_id: params[1], usuario_id: params[2], empresa_id: params[5], total: '0.00', status: 'finalizada' }] });
    }
    if (sql.includes('SELECT id, ativo FROM produtos')) return Promise.resolve({ rows: [{ id: params[0], ativo: true }] });
    if (sql.includes('INSERT INTO itens_venda')) return Promise.resolve({ rows: [{ id: 1, venda_id: 1, produto_id: 1 }] });
    return Promise.resolve({ rows: [] });
  });
  return client;
}

const sqls = (client) => client.query.mock.calls.map(([sql]) => sql);
const venda = (pagamentos) => ({ canal_id: 1, usuario_id: 2, empresa_id: 9, itens: [{ produto_id: 1, quantidade: 1 }], pagamentos });
const COBRANCA = '3f2b7c0e-6b1a-4c53-9a3e-0d1f2a3b4c5d';

let client;
beforeEach(() => {
  jest.resetAllMocks();
  client = makeFakeClient();
  db.connect = jest.fn().mockResolvedValue(client);
  precosRepository.buscarPrecoVigente.mockResolvedValue({ preco_venda: '100.00' });
  estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 }, custo: '4.00' });
  taxasPlataformaRepository.apurar.mockResolvedValue({ id: 77 });
  pagamentosVendaRepository.criar.mockResolvedValue({ id: 11 });
  parcelasPagamentoRepository.criar.mockResolvedValue({ id: 1 });
  parcelasPagamentoRepository.listarPorPagamento.mockResolvedValue([]);
  bloqueiosPixRepository.pixManualBloqueado.mockResolvedValue(false);
});

describe('criar — bloqueio de Pix manual', () => {
  test('Pix manual com o bloqueio ativo: 403 antes de criar a venda, mexer no estoque ou gravar pagamento', async () => {
    bloqueiosPixRepository.pixManualBloqueado.mockResolvedValue(true);

    await expect(vendasRepository.criar(venda([{ forma_pagamento: 'pix', valor: 100 }])))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/Pix manual está indisponível/) });

    expect(bloqueiosPixRepository.pixManualBloqueado).toHaveBeenCalledWith(9, client);
    expect(sqls(client).some((s) => s.includes('INSERT INTO vendas'))).toBe(false);
    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
    expect(pagamentosVendaRepository.criar).not.toHaveBeenCalled();
    expect(sqls(client)).toContain('ROLLBACK');
  });

  test('a mensagem não cita taxa, motivo nem sinalização', async () => {
    bloqueiosPixRepository.pixManualBloqueado.mockResolvedValue(true);
    const erro = await vendasRepository.criar(venda([{ forma_pagamento: 'pix', valor: 100 }])).catch((e) => e);
    expect(erro.message).not.toMatch(/taxa|sinaliz|fuga|padr/i);
  });

  test('Pix manual dentro de um pagamento misto também é recusado', async () => {
    bloqueiosPixRepository.pixManualBloqueado.mockResolvedValue(true);
    await expect(vendasRepository.criar(venda([{ forma_pagamento: 'pix', valor: 30 }, { forma_pagamento: 'dinheiro', valor: 70 }])))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('sem bloqueio ativo, o Pix manual segue normalmente', async () => {
    await vendasRepository.criar(venda([{ forma_pagamento: 'pix', valor: 100 }]));
    expect(bloqueiosPixRepository.pixManualBloqueado).toHaveBeenCalledTimes(1);
    expect(sqls(client)).toContain('COMMIT');
  });

  test('Pix com cobrança do Mercado Pago NÃO consulta o bloqueio (não é Pix manual)', async () => {
    cobrancasPagamentoRepository.consumirParaVenda.mockResolvedValue({ provedor: 'mercadopago', id_externo: 'mp-1' });
    await vendasRepository.criar(venda([{ forma_pagamento: 'pix', valor: 100, cobranca_codigo: COBRANCA }]));
    expect(bloqueiosPixRepository.pixManualBloqueado).not.toHaveBeenCalled();
    expect(sqls(client)).toContain('COMMIT');
  });

  test.each([['dinheiro'], ['debito']])('%s não consulta o bloqueio', async (forma) => {
    await vendasRepository.criar(venda([{ forma_pagamento: forma, valor: 100 }]));
    expect(bloqueiosPixRepository.pixManualBloqueado).not.toHaveBeenCalled();
  });

  test('venda sem pagamentos[] (legado: dinheiro/crediário) não consulta o bloqueio', async () => {
    await vendasRepository.criar({ canal_id: 1, usuario_id: 2, empresa_id: 9, itens: [{ produto_id: 1, quantidade: 1 }] });
    expect(bloqueiosPixRepository.pixManualBloqueado).not.toHaveBeenCalled();
  });
});
