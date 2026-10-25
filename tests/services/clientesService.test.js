jest.mock('../../src/repositories/clientesRepository');

const clientesRepository = require('../../src/repositories/clientesRepository');
const clientesService = require('../../src/services/clientesService');

// Vendedor comum: só os clientes que ele cadastrou. Gerente/analista (ver_todos_clientes) e admin: todos.
const vendedor = { id: 2, empresa_id: 9, role: 'vendedor', capacidades: [] };
const analista = { id: 5, empresa_id: 9, role: 'vendedor', capacidades: ['ver_todos_clientes'] };
const admin = { id: 1, empresa_id: 9, role: 'admin', capacidades: [] };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('escopoDeClientes', () => {
  test('sem ver_todos_clientes devolve o id do usuário; com a capacidade (ou admin) devolve undefined', () => {
    expect(clientesService.escopoDeClientes(vendedor)).toBe(2);
    expect(clientesService.escopoDeClientes(analista)).toBeUndefined();
    expect(clientesService.escopoDeClientes(admin)).toBeUndefined();
  });
});

describe('listar', () => {
  test('filtra pela empresa do JWT e, para vendedor, pelo próprio id', async () => {
    clientesRepository.listar.mockResolvedValue([{ id: 1 }]);

    await expect(clientesService.listar(vendedor)).resolves.toEqual([{ id: 1 }]);
    await clientesService.listar(analista);

    expect(clientesRepository.listar.mock.calls[0]).toEqual([9, 2]);
    expect(clientesRepository.listar.mock.calls[1]).toEqual([9, undefined]);
  });
});

describe('criar', () => {
  test('o responsável e a empresa são sempre os do JWT, mesmo se o corpo tentar mandar outros', async () => {
    clientesRepository.criar.mockResolvedValue({ id: 7 });

    await clientesService.criar({ nome: 'Ana', criado_por: 99, empresa_id: 99 }, vendedor);

    expect(clientesRepository.criar).toHaveBeenCalledWith({ nome: 'Ana', empresa_id: 9, criado_por: 2 });
  });
});

describe('atualizar', () => {
  test('throws 404 when the cliente does not exist (buscarPorId returns null)', async () => {
    clientesRepository.buscarPorId.mockResolvedValue(null);

    await expect(clientesService.atualizar(999, { nome: 'Novo Nome' }, vendedor)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Cliente não encontrado'
    });
    expect(clientesRepository.atualizar).not.toHaveBeenCalled();
  });

  test('delegates to the repository with the scope when the cliente exists', async () => {
    clientesRepository.buscarPorId.mockResolvedValue({ id: 1, nome: 'Antigo', empresa_id: 9 });
    clientesRepository.atualizar.mockResolvedValue({ id: 1, nome: 'Novo Nome', empresa_id: 9 });

    const resultado = await clientesService.atualizar(1, { nome: 'Novo Nome' }, vendedor);

    expect(resultado).toEqual({ id: 1, nome: 'Novo Nome', empresa_id: 9 });
    expect(clientesRepository.buscarPorId).toHaveBeenCalledWith(1, 9, 2);
    expect(clientesRepository.atualizar).toHaveBeenCalledWith(1, { nome: 'Novo Nome' }, 9, 2);
  });

  test('404 também quando o UPDATE restrito não atinge nenhuma linha', async () => {
    clientesRepository.buscarPorId.mockResolvedValue({ id: 1 });
    clientesRepository.atualizar.mockResolvedValue(null);

    await expect(clientesService.atualizar(1, { nome: 'X' }, analista)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('historico', () => {
  test('throws 404 when there are no registros', async () => {
    clientesRepository.getHistorico.mockResolvedValue([]);

    await expect(clientesService.historico(1, vendedor)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Nenhum histórico encontrado'
    });
  });

  test('returns the registros when present, com o escopo do usuário', async () => {
    clientesRepository.getHistorico.mockResolvedValue([{ venda_id: 1 }]);

    await expect(clientesService.historico(1, vendedor)).resolves.toEqual([{ venda_id: 1 }]);
    expect(clientesRepository.getHistorico).toHaveBeenCalledWith(1, 9, 2);
  });
});

describe('ranking', () => {
  test('passa o escopo do usuário', async () => {
    clientesRepository.getRanking.mockResolvedValue([]);

    await clientesService.ranking(vendedor);
    await clientesService.ranking(admin);

    expect(clientesRepository.getRanking.mock.calls[0]).toEqual([9, 2]);
    expect(clientesRepository.getRanking.mock.calls[1]).toEqual([9, undefined]);
  });
});

describe('anonimizar', () => {
  test('delegates to the repository and returns only id/anonimizado/anonimizado_em', async () => {
    clientesRepository.anonimizar.mockResolvedValue({
      id: 1,
      nome: 'Cliente removido',
      telefone: null,
      email: null,
      ativo: false,
      anonimizado: true,
      anonimizado_em: '2026-09-06T00:00:00.000Z'
    });

    await expect(clientesService.anonimizar(1, 9)).resolves.toEqual({
      id: 1,
      anonimizado: true,
      anonimizado_em: '2026-09-06T00:00:00.000Z'
    });
    expect(clientesRepository.anonimizar).toHaveBeenCalledWith(1, 9);
  });

  test('propagates errors from the repository (404/409)', async () => {
    const AppError = require('../../src/errors/AppError');
    clientesRepository.anonimizar.mockRejectedValue(new AppError('Cliente já foi anonimizado', 409));

    await expect(clientesService.anonimizar(1, 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cliente já foi anonimizado'
    });
  });
});

describe('totalGasto', () => {
  test('throws 404 when the cliente does not exist', async () => {
    clientesRepository.getTotalGasto.mockResolvedValue(null);

    await expect(clientesService.totalGasto(999, vendedor)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Cliente não encontrado'
    });
  });

  test('returns the dados when the cliente exists, com o escopo do usuário', async () => {
    clientesRepository.getTotalGasto.mockResolvedValue({ id: 1, total_gasto: 100 });

    await expect(clientesService.totalGasto(1, vendedor)).resolves.toEqual({ id: 1, total_gasto: 100 });
    expect(clientesRepository.getTotalGasto).toHaveBeenCalledWith(1, 9, 2);
  });
});
