jest.mock('../../src/repositories/fichasTecnicasRepository');
jest.mock('../../src/repositories/produtosRepository');

const fichasTecnicasRepository = require('../../src/repositories/fichasTecnicasRepository');
const produtosRepository = require('../../src/repositories/produtosRepository');
const fichasTecnicasService = require('../../src/services/fichasTecnicasService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => jest.clearAllMocks());

describe('criar', () => {
  test('delegates to the repository with produto_id/usuario_id/empresa_id attached', async () => {
    fichasTecnicasRepository.criarVersao.mockResolvedValue({ id: 1, custo_sugerido: 40 });

    const result = await fichasTecnicasService.criar(5, { itens: [{ insumo_produto_id: 2, quantidade_necessaria: 3 }] }, 7, 9);

    expect(fichasTecnicasRepository.criarVersao).toHaveBeenCalledWith({
      produto_id: 5, itens: [{ insumo_produto_id: 2, quantidade_necessaria: 3 }], usuario_id: 7, empresa_id: 9
    });
    expect(result.id).toBe(1);
  });
});

describe('buscarVigente', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(fichasTecnicasService.buscarVigente(5, 9)).rejects.toMatchObject({
      statusCode: 404, message: 'Produto não encontrado'
    });
    expect(fichasTecnicasRepository.buscarVigentePorProduto).not.toHaveBeenCalled();
  });

  test('throws 404 when the produto exists but has no vigente ficha', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 5 });
    fichasTecnicasRepository.buscarVigentePorProduto.mockResolvedValue(null);

    await expect(fichasTecnicasService.buscarVigente(5, 9)).rejects.toMatchObject({
      statusCode: 404, message: 'Ficha técnica não encontrada'
    });
  });

  test('returns the ficha when found', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 5 });
    fichasTecnicasRepository.buscarVigentePorProduto.mockResolvedValue({ id: 1, custo_sugerido: 40 });

    const result = await fichasTecnicasService.buscarVigente(5, 9);
    expect(result.custo_sugerido).toBe(40);
  });
});

describe('historico', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);
    await expect(fichasTecnicasService.historico(5, 9)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('returns the list (possibly empty) when the produto exists', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 5 });
    fichasTecnicasRepository.buscarHistoricoPorProduto.mockResolvedValue([]);

    const result = await fichasTecnicasService.historico(5, 9);
    expect(result).toEqual([]);
  });
});
