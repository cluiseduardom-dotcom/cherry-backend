jest.mock('../../src/repositories/niveisCategoriaRepository');

const niveisCategoriaRepository = require('../../src/repositories/niveisCategoriaRepository');
const niveisCategoriaService = require('../../src/services/niveisCategoriaService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('forwards empresa_id', async () => {
    niveisCategoriaRepository.listar.mockResolvedValue([{ id: 1, nivel: 1, nome: 'Família' }]);

    const result = await niveisCategoriaService.listar(9);

    expect(niveisCategoriaRepository.listar).toHaveBeenCalledWith(9);
    expect(result).toEqual([{ id: 1, nivel: 1, nome: 'Família' }]);
  });
});

describe('criar', () => {
  test('creates when no duplicate nivel exists', async () => {
    niveisCategoriaRepository.buscarPorNivel.mockResolvedValue(null);
    niveisCategoriaRepository.criar.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família', empresa_id: 9 });

    const result = await niveisCategoriaService.criar({ nivel: 1, nome: 'Família' }, 9);

    expect(niveisCategoriaRepository.buscarPorNivel).toHaveBeenCalledWith(1, 9);
    expect(niveisCategoriaRepository.criar).toHaveBeenCalledWith({ nivel: 1, nome: 'Família', empresa_id: 9 });
    expect(result.nivel).toBe(1);
  });

  test('throws 409 when the nivel already has a label', async () => {
    niveisCategoriaRepository.buscarPorNivel.mockResolvedValue({ id: 1 });

    await expect(
      niveisCategoriaService.criar({ nivel: 1, nome: 'Família' }, 9)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Já existe um rótulo para este nível' });

    expect(niveisCategoriaRepository.criar).not.toHaveBeenCalled();
  });

  test('converts a unique-violation race on insert into a clean 409', async () => {
    niveisCategoriaRepository.buscarPorNivel.mockResolvedValue(null);
    const erroColisao = new Error('duplicate key value violates unique constraint "niveis_categoria_empresa_id_nivel_key"');
    erroColisao.code = '23505';
    niveisCategoriaRepository.criar.mockRejectedValue(erroColisao);

    await expect(
      niveisCategoriaService.criar({ nivel: 1, nome: 'Família' }, 9)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Já existe um rótulo para este nível' });
  });
});

describe('atualizar', () => {
  test('updates nome via the repository', async () => {
    niveisCategoriaRepository.atualizarNome.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const result = await niveisCategoriaService.atualizar(1, { nome: 'Novo Nome' }, 9);

    expect(niveisCategoriaRepository.atualizarNome).toHaveBeenCalledWith(1, 'Novo Nome', 9);
    expect(result.nome).toBe('Novo Nome');
  });

  test('throws 404 when the nivel does not exist for this empresa', async () => {
    niveisCategoriaRepository.atualizarNome.mockResolvedValue(null);

    await expect(niveisCategoriaService.atualizar(999, { nome: 'X' }, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Nível não encontrado'
    });
  });
});

describe('remover', () => {
  test('deletes an existing nivel', async () => {
    niveisCategoriaRepository.remover.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família' });

    const result = await niveisCategoriaService.remover(1, 9);

    expect(niveisCategoriaRepository.remover).toHaveBeenCalledWith(1, 9);
    expect(result.nivel).toBe(1);
  });

  test('throws 404 when the nivel does not exist for this empresa', async () => {
    niveisCategoriaRepository.remover.mockResolvedValue(null);

    await expect(niveisCategoriaService.remover(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Nível não encontrado'
    });
  });
});
