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
const taxasPlataformaRepository = require('../../src/repositories/taxasPlataformaRepository');
const comissoesRepository = require('../../src/repositories/comissoesRepository');
const cancelamentosRepository = require('../../src/repositories/cancelamentosRepository');
const { executarComLock } = require('../../src/repositories/shared/transacoes');
const AppError = require('../../src/errors/AppError');
const vendasRepository = require('../../src/repositories/vendasRepository');

// Comissão do vendedor: congelada na mesma transação da venda e estornada no cancelamento.
// O cálculo e o SQL em si são cobertos em tests/repositories/comissoesRepository.test.js e
// tests/utils/comissao.test.js; aqui só o encaixe (wiring) dentro da transação da venda.

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

function prepararVenda({ preco = '100.00', custo = '40.00' } = {}) {
  const fakeClient = makeFakeClient();
  db.connect = jest.fn().mockResolvedValue(fakeClient);
  precosRepository.buscarPrecoVigente.mockResolvedValue({ preco_venda: preco });
  estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 }, custo });
  return fakeClient;
}

const sqls = (client) => client.query.mock.calls.map(([sql]) => sql);

beforeEach(() => {
  jest.resetAllMocks();
  taxasPlataformaRepository.apurar.mockResolvedValue({ id: 77 });
  comissoesRepository.apurar.mockResolvedValue({ id: 88 });
});

describe('criar — comissão do vendedor', () => {
  test('apura a comissão UMA vez, no client da transação, para o vendedor da venda', async () => {
    const fakeClient = prepararVenda({ preco: '100.00' });

    await vendasRepository.criar({
      canal_id: 1, usuario_id: 2, empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 1 }]
    });

    expect(comissoesRepository.apurar).toHaveBeenCalledTimes(1);
    expect(comissoesRepository.apurar).toHaveBeenCalledWith(
      { venda_id: 1, empresa_id: 9, usuario_id: 2, base: 100 },
      fakeClient
    );
    expect(sqls(fakeClient)).toContain('COMMIT');
  });

  test('a base é subtotal - desconto, SEM os juros do crediário', async () => {
    prepararVenda({ preco: '100.00' });

    await vendasRepository.criar({
      canal_id: 1, usuario_id: 2, empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 1 }],
      desconto: 10, juros: 5
    });

    // total da venda = 95,00 (taxa da plataforma), mas a comissão incide sobre 90,00
    expect(taxasPlataformaRepository.apurar).toHaveBeenCalledWith(expect.objectContaining({ total: 95 }), expect.anything());
    expect(comissoesRepository.apurar).toHaveBeenCalledWith(expect.objectContaining({ base: 90 }), expect.anything());
  });

  test('falha ao apurar a comissão faz ROLLBACK da venda inteira', async () => {
    const fakeClient = prepararVenda();
    comissoesRepository.apurar.mockRejectedValue(new AppError('Percentual de comissão inválido', 500));

    await expect(
      vendasRepository.criar({
        canal_id: 1, usuario_id: 2, empresa_id: 9,
        itens: [{ produto_id: 1, quantidade: 1 }]
      })
    ).rejects.toMatchObject({ statusCode: 500 });

    expect(sqls(fakeClient)).toContain('ROLLBACK');
    expect(sqls(fakeClient)).not.toContain('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('a resposta de criar não expõe a comissão', async () => {
    prepararVenda();
    comissoesRepository.apurar.mockResolvedValue({ id: 88, valor: '5.00' });

    const resultado = await vendasRepository.criar({
      canal_id: 1, usuario_id: 2, empresa_id: 9,
      itens: [{ produto_id: 1, quantidade: 1 }]
    });

    expect(JSON.stringify(resultado)).not.toMatch(/comiss/i);
  });
});

describe('cancelar — comissão do vendedor', () => {
  const OPCOES = { motivo: 'Cliente desistiu da compra', login: 'vendedor@teste.invalid', faixaAutorizada: 'ate_7_dias' };

  beforeEach(() => {
    cancelamentosRepository.buscarIdadeDaVenda.mockResolvedValue({ dias: 2, status: 'finalizada', usuario_id: 9 });
    cancelamentosRepository.inserir.mockResolvedValue({ id: 1 });
  });

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

  test('estorna a comissão (nunca apaga) no MESMO client da transação travada', async () => {
    const client = clienteDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );

    await vendasRepository.cancelar(1, 9, 5, OPCOES);

    expect(comissoesRepository.estornarPorVendaId).toHaveBeenCalledTimes(1);
    expect(comissoesRepository.estornarPorVendaId).toHaveBeenCalledWith(1, 5, client);
  });

  test('cancelamento bloqueado (conta a receber já recebida) não estorna a comissão', async () => {
    const client = clienteDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );
    contasReceberRepository.cancelarPorVendaId.mockRejectedValue(
      new AppError('Venda com conta a receber já recebida não pode ser cancelada', 409)
    );

    await expect(vendasRepository.cancelar(1, 9, 5, OPCOES)).rejects.toMatchObject({ statusCode: 409 });

    expect(comissoesRepository.estornarPorVendaId).not.toHaveBeenCalled();
  });

  test('falha ao estornar a comissão aborta o cancelamento antes de mexer em estoque ou status', async () => {
    const client = clienteDeCancelamento();
    executarComLock.mockImplementation((tabela, chave, empresa_id, clienteExterno, callback) =>
      callback({ id: 1, status: 'finalizada' }, client)
    );
    comissoesRepository.estornarPorVendaId.mockRejectedValue(new Error('falha'));

    await expect(vendasRepository.cancelar(1, 9, 5, OPCOES)).rejects.toThrow('falha');

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
    expect(sqls(client).some((sql) => sql.includes("UPDATE vendas SET status = 'cancelada'"))).toBe(false);
  });
});
