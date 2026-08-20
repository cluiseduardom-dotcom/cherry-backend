jest.mock('../../src/repositories/despesasFixasRepository');

const despesasFixasRepository = require('../../src/repositories/despesasFixasRepository');
const despesasFixasService = require('../../src/services/despesasFixasService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('delegates to the repository with the empresaId', async () => {
    despesasFixasRepository.listar.mockResolvedValue([{ id: 1 }]);

    const resultado = await despesasFixasService.listar(9);

    expect(despesasFixasRepository.listar).toHaveBeenCalledWith(9);
    expect(resultado).toEqual([{ id: 1 }]);
  });
});

describe('criar', () => {
  test('attaches empresa_id and delegates to the repository', async () => {
    despesasFixasRepository.criar.mockResolvedValue({ id: 1, categoria: 'pessoal', descricao: 'Salários', valor: 5000 });

    const resultado = await despesasFixasService.criar({ categoria: 'pessoal', descricao: 'Salários', valor: 5000 }, 9);

    expect(despesasFixasRepository.criar).toHaveBeenCalledWith({
      categoria: 'pessoal', descricao: 'Salários', valor: 5000, empresa_id: 9
    });
    expect(resultado.id).toBe(1);
  });
});

describe('atualizar', () => {
  test('returns the updated despesa', async () => {
    despesasFixasRepository.atualizar.mockResolvedValue({ id: 1, valor: 200 });

    const resultado = await despesasFixasService.atualizar(1, { valor: 200 }, 9);

    expect(despesasFixasRepository.atualizar).toHaveBeenCalledWith(1, { valor: 200 }, 9);
    expect(resultado).toEqual({ id: 1, valor: 200 });
  });

  test('throws 404 when the repository returns null', async () => {
    despesasFixasRepository.atualizar.mockResolvedValue(null);

    await expect(despesasFixasService.atualizar(999, { valor: 200 }, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Despesa fixa não encontrada'
    });
  });
});

describe('remover', () => {
  test('returns the soft-deleted despesa', async () => {
    despesasFixasRepository.deletar.mockResolvedValue({ id: 1, deletado_em: '2026-08-19' });

    const resultado = await despesasFixasService.remover(1, 9);

    expect(despesasFixasRepository.deletar).toHaveBeenCalledWith(1, 9);
    expect(resultado.deletado_em).toBe('2026-08-19');
  });

  test('throws 404 when the repository returns null', async () => {
    despesasFixasRepository.deletar.mockResolvedValue(null);

    await expect(despesasFixasService.remover(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Despesa fixa não encontrada'
    });
  });
});

describe('alternarAtivo', () => {
  test('returns the toggled despesa', async () => {
    despesasFixasRepository.alternarAtivo.mockResolvedValue({ id: 1, ativo: false });

    const resultado = await despesasFixasService.alternarAtivo(1, 9);

    expect(despesasFixasRepository.alternarAtivo).toHaveBeenCalledWith(1, 9);
    expect(resultado.ativo).toBe(false);
  });

  test('throws 404 when the repository returns null', async () => {
    despesasFixasRepository.alternarAtivo.mockResolvedValue(null);

    await expect(despesasFixasService.alternarAtivo(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Despesa fixa não encontrada'
    });
  });
});
