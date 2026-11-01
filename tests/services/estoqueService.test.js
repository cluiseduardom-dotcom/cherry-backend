jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/repositories/produtosRepository');

const estoqueRepository = require('../../src/repositories/estoqueRepository');
const produtosRepository = require('../../src/repositories/produtosRepository');
const estoqueService = require('../../src/services/estoqueService');

beforeEach(() => {
  jest.clearAllMocks();
});

const admin = { id: 1, role: 'admin', empresa_id: 7 };
const estoquista = { id: 2, role: 'estoquista', empresa_id: 7, capacidades: [] };
const estoquistaComCapacidades = (...capacidades) => ({ ...estoquista, capacidades });

describe('registrarMovimentacao', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(
      estoqueService.registrarMovimentacao(999, { tipo: 'saida', quantidade: 5, motivo_codigo: 'perda' }, 1, 7, estoquista)
    ).rejects.toMatchObject({ statusCode: 404, message: 'Produto não encontrado' });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('throws 400 when the produto is inactive', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, ativo: false });

    await expect(
      estoqueService.registrarMovimentacao(1, { tipo: 'saida', quantidade: 5, motivo_codigo: 'perda' }, 1, 7, estoquista)
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });

  test('throws 409 when the repository reports insufficient stock', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, ativo: true });
    estoqueRepository.criarMovimentacao.mockResolvedValue({ erro: 'ESTOQUE_INSUFICIENTE' });

    await expect(
      estoqueService.registrarMovimentacao(1, { tipo: 'saida', quantidade: 999, motivo_codigo: 'perda' }, 1, 7, estoquista)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Estoque insuficiente para essa saída' });
  });

  test('saida: estoquista can register it; motivo text and origem come from the reason list', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, ativo: true });
    estoqueRepository.criarMovimentacao.mockResolvedValue({
      movimentacao: { id: 1, produto_id: 1, tipo: 'saida', quantidade: 2, estoque_resultante: 8 }
    });

    const result = await estoqueService.registrarMovimentacao(
      1, { tipo: 'saida', quantidade: 2, motivo_codigo: 'avaria', observacao: 'Caiu no chão' }, 42, 7, estoquista
    );

    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith({
      produto_id: 1,
      tipo: 'saida',
      quantidade: 2,
      motivo: 'Avaria — Caiu no chão',
      usuario_id: 42,
      empresa_id: 7,
      local_id: undefined,
      origem: 'avaria',
      bloquearAjusteParaMais: false,
      exigirSemHistorico: false
    });
    expect(result.estoque_resultante).toBe(8);
  });

  describe('entrada avulsa (exceções à regra "entrada só por Compra ou Recebimento")', () => {
    beforeEach(() => {
      produtosRepository.buscarPorId.mockResolvedValue({ id: 1, ativo: true });
      estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });
    });

    test('estoque_inicial: only the admin, and the repository is told to require a product without history', async () => {
      await expect(
        estoqueService.registrarMovimentacao(1, { tipo: 'entrada', quantidade: 5, motivo_codigo: 'estoque_inicial' }, 2, 7, estoquista)
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();

      await estoqueService.registrarMovimentacao(1, { tipo: 'entrada', quantidade: 5, motivo_codigo: 'estoque_inicial' }, 1, 7, admin);

      expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
        expect.objectContaining({ origem: 'estoque_inicial', exigirSemHistorico: true, motivo: 'Estoque inicial' })
      );
    });

    test('estoque_inicial is not delegable by capacity: a cargo with every stock capacity still gets 403', async () => {
      const usuario = estoquistaComCapacidades('ajustar_estoque', 'receber_sem_compra');

      await expect(
        estoqueService.registrarMovimentacao(1, { tipo: 'entrada', quantidade: 5, motivo_codigo: 'estoque_inicial' }, 2, 7, usuario)
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    test('recebimento_sem_compra: needs the receber_sem_compra capacity (admin has it)', async () => {
      const dados = { tipo: 'entrada', quantidade: 5, motivo_codigo: 'recebimento_sem_compra', observacao: 'Bonificação' };

      await expect(estoqueService.registrarMovimentacao(1, dados, 2, 7, estoquista)).rejects.toMatchObject({ statusCode: 403 });
      await expect(estoqueService.registrarMovimentacao(1, dados, 2, 7, estoquistaComCapacidades('ajustar_estoque'))).rejects.toMatchObject({ statusCode: 403 });
      await expect(estoqueService.registrarMovimentacao(1, dados, 2, 7, undefined)).rejects.toMatchObject({ statusCode: 403 });
      expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();

      await estoqueService.registrarMovimentacao(1, dados, 2, 7, estoquistaComCapacidades('receber_sem_compra'));
      await estoqueService.registrarMovimentacao(1, dados, 1, 7, admin);

      expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledTimes(2);
      expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
        expect.objectContaining({ origem: 'recebimento_sem_compra', motivo: 'Recebimento sem compra — Bonificação', exigirSemHistorico: false })
      );
    });

    test('translates ENTRADA_INICIAL_COM_HISTORICO into 409', async () => {
      estoqueRepository.criarMovimentacao.mockResolvedValue({ erro: 'ENTRADA_INICIAL_COM_HISTORICO' });

      await expect(
        estoqueService.registrarMovimentacao(1, { tipo: 'entrada', quantidade: 5, motivo_codigo: 'estoque_inicial' }, 1, 7, admin)
      ).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('ajuste', () => {
    beforeEach(() => {
      produtosRepository.buscarPorId.mockResolvedValue({ id: 1, ativo: true });
      estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });
    });

    test('without ajustar_estoque the repository is told to refuse an increase', async () => {
      await estoqueService.registrarMovimentacao(1, { tipo: 'ajuste', quantidade: 3, motivo_codigo: 'contagem' }, 2, 7, estoquista);

      expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
        expect.objectContaining({ bloquearAjusteParaMais: true, origem: 'contagem' })
      );
    });

    test('with ajustar_estoque (or admin) the increase is allowed', async () => {
      await estoqueService.registrarMovimentacao(1, { tipo: 'ajuste', quantidade: 3, motivo_codigo: 'contagem' }, 2, 7, estoquistaComCapacidades('ajustar_estoque'));
      await estoqueService.registrarMovimentacao(1, { tipo: 'ajuste', quantidade: 3, motivo_codigo: 'contagem' }, 1, 7, admin);

      expect(estoqueRepository.criarMovimentacao).toHaveBeenNthCalledWith(1, expect.objectContaining({ bloquearAjusteParaMais: false }));
      expect(estoqueRepository.criarMovimentacao).toHaveBeenNthCalledWith(2, expect.objectContaining({ bloquearAjusteParaMais: false }));
    });

    test('without the usuario object nothing is allowed (secure default)', async () => {
      await estoqueService.registrarMovimentacao(1, { tipo: 'ajuste', quantidade: 3, motivo_codigo: 'contagem' }, 2, 7);

      expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(expect.objectContaining({ bloquearAjusteParaMais: true }));
    });

    test('translates AJUSTE_PARA_MAIS_NAO_AUTORIZADO into 403', async () => {
      estoqueRepository.criarMovimentacao.mockResolvedValue({ erro: 'AJUSTE_PARA_MAIS_NAO_AUTORIZADO' });

      await expect(
        estoqueService.registrarMovimentacao(1, { tipo: 'ajuste', quantidade: 30, motivo_codigo: 'contagem' }, 2, 7, estoquista)
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });
});

describe('historicoPorProduto', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(estoqueService.historicoPorProduto(999, { page: 1, pageSize: 20 })).rejects.toMatchObject({
      statusCode: 404
    });
  });

  test('paginates the history', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
    estoqueRepository.listarPorProduto.mockResolvedValue({ items: [{ id: 1 }], total: 1 });

    const result = await estoqueService.historicoPorProduto(1, { page: 1, pageSize: 20 }, 7);

    expect(estoqueRepository.listarPorProduto).toHaveBeenCalledWith(1, 7, { limit: 20, offset: 0 });
    expect(result).toEqual({ items: [{ id: 1 }], page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });
});

test('alertasEstoqueBaixo delegates to the repository', async () => {
  estoqueRepository.getEstoqueBaixo.mockResolvedValue([{ id: 1, estoque_atual: 1, estoque_minimo: 5 }]);

  await expect(estoqueService.alertasEstoqueBaixo(7)).resolves.toEqual([
    { id: 1, estoque_atual: 1, estoque_minimo: 5 }
  ]);
  expect(estoqueRepository.getEstoqueBaixo).toHaveBeenCalledWith(7);
});


describe('listarMovimentacoesRelatorio', () => {
  test('calcula paginação e delega filtros ao repository', async () => {
    estoqueRepository.listarMovimentacoesRelatorio.mockResolvedValue({ items: [{ id: 1 }], total: 1 });

    const result = await estoqueService.listarMovimentacoesRelatorio({
      page: 2,
      pageSize: 10,
      produto_id: 7,
      data_de: '2026-09-01',
      data_ate: '2026-09-30'
    }, 9);

    expect(estoqueRepository.listarMovimentacoesRelatorio).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      produto_id: 7,
      data_de: '2026-09-01',
      data_ate: '2026-09-30',
      limit: 10,
      offset: 10,
      empresa_id: 9
    });

    expect(result).toEqual({
      items: [{ id: 1 }],
      page: 2,
      pageSize: 10,
      total: 1,
      totalPages: 1
    });
  });
});

describe('estoque por local', () => {
  test('repassa local_id ao repositório e traduz LOCAL_NAO_ENCONTRADO em 404', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, ativo: true });
    estoqueRepository.criarMovimentacao.mockResolvedValue({ erro: 'LOCAL_NAO_ENCONTRADO' });

    await expect(
      estoqueService.registrarMovimentacao(1, { tipo: 'saida', quantidade: 2, motivo_codigo: 'perda', local_id: 9 }, 1, 4, estoquista)
    ).rejects.toMatchObject({ statusCode: 404, message: 'Local de estoque não encontrado' });

    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(expect.objectContaining({ local_id: 9, empresa_id: 4 }));
  });

  test('saldosPorLocal devolve 404 para produto inexistente (ou de outra empresa)', async () => {
    estoqueRepository.saldosPorLocal.mockResolvedValue(null);

    await expect(estoqueService.saldosPorLocal(99, 4)).rejects.toMatchObject({ statusCode: 404 });
    expect(estoqueRepository.saldosPorLocal).toHaveBeenCalledWith(99, 4);
  });
});
