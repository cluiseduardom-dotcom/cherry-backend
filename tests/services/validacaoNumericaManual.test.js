jest.mock('../../src/config/db');
jest.mock('../../src/repositories/recebimentosRepository');

const db = require('../../src/config/db');
const recebimentosRepository = require('../../src/repositories/recebimentosRepository');
const pagamentosService = require('../../src/services/pagamentosService');
const recebimentosService = require('../../src/services/recebimentosService');

const usuario = { id: 1, empresa_id: 1, role: 'admin' };
const invalidos = ['Infinity', '-Infinity', 'NaN', 'abc', '', null, undefined, Infinity, NaN];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('pagamentosService — valor não finito/NaN é barrado antes de tocar no banco', () => {
  test.each(invalidos)('receberParcela rejeita valor %p com 400', async (valor) => {
    await expect(pagamentosService.receberParcela(1, { valor }, usuario)).rejects.toMatchObject({ statusCode: 400 });

    expect(db.connect).not.toHaveBeenCalled();
  });

  test.each(invalidos)('estornarPagamento rejeita valor %p com 400', async (valor) => {
    await expect(pagamentosService.estornarPagamento(1, { valor, motivo: 'x' }, usuario)).rejects.toMatchObject({ statusCode: 400 });

    expect(db.connect).not.toHaveBeenCalled();
  });
});

describe('recebimentosService.adicionarItem — quantidade/preço não finitos', () => {
  const recebimento = { id: 5, status: 'RASCUNHO' };
  const pedidoItem = { id: 8, quantidade: 10, produto_id: 1, unidade: 'UN', preco_unitario: 5 };

  beforeEach(() => {
    recebimentosRepository.buscarPorId.mockResolvedValue(recebimento);
    recebimentosRepository.buscarPedidoItem.mockResolvedValue(pedidoItem);
    recebimentosRepository.quantidadeJaRecebida.mockResolvedValue(0);
    recebimentosRepository.adicionarItem.mockResolvedValue({ id: 1 });
  });

  const dados = (extra) => ({ pedido_compra_item_id: 8, descricao_snapshot: 'Item', quantidade_recebida: 1, ...extra });

  test.each(['Infinity', Infinity, NaN, 'abc', null, undefined])('rejeita quantidade_recebida %p', async (quantidade_recebida) => {
    await expect(recebimentosService.adicionarItem(5, dados({ quantidade_recebida }), usuario))
      .rejects.toMatchObject({ statusCode: 400 });

    expect(recebimentosRepository.adicionarItem).not.toHaveBeenCalled();
  });

  test.each(['Infinity', NaN, 'abc', -1])('rejeita preco_unitario %p', async (preco_unitario) => {
    await expect(recebimentosService.adicionarItem(5, dados({ preco_unitario }), usuario))
      .rejects.toMatchObject({ statusCode: 400 });

    expect(recebimentosRepository.adicionarItem).not.toHaveBeenCalled();
  });

  test('aceita valores finitos e grava a quantidade já convertida em número', async () => {
    await recebimentosService.adicionarItem(5, dados({ quantidade_recebida: '3', preco_unitario: '2.5' }), usuario);

    expect(recebimentosRepository.adicionarItem).toHaveBeenCalledWith(expect.objectContaining({ quantidade_recebida: 3 }));
  });
});

describe('recebimentosService.criar — ids não inteiros', () => {
  test.each([['Infinity', 1], [1, 'Infinity'], [1.5, 1], [1, 'abc']])('rejeita pedido_compra_id=%p fornecedor_id=%p', async (pedido_compra_id, fornecedor_id) => {
    await expect(recebimentosService.criar({ pedido_compra_id, fornecedor_id, numero: 'R1' }))
      .rejects.toMatchObject({ statusCode: 400 });

    expect(recebimentosRepository.criar).not.toHaveBeenCalled();
  });
});
