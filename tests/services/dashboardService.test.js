jest.mock('../../src/repositories/dashboardRepository');
jest.mock('../../src/repositories/precosRepository');

const dashboardRepository = require('../../src/repositories/dashboardRepository');
const precosRepository = require('../../src/repositories/precosRepository');
const dashboardService = require('../../src/services/dashboardService');

beforeEach(() => {
  jest.clearAllMocks();
});

test('curvaABC delegates to the repository', async () => {
  dashboardRepository.getCurvaABC.mockResolvedValue([{ id: 1, nome: 'X', faturamento: '100.00', curva: 'A' }]);

  await expect(dashboardService.curvaABC()).resolves.toEqual([{ id: 1, nome: 'X', faturamento: '100.00', curva: 'A' }]);
});

describe('giro', () => {
  test('delegates to the repository with the given período and trims to giro-relevant fields', async () => {
    dashboardRepository.getGiroECobertura.mockResolvedValue([
      { id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, giro: 0.5, cobertura_dias: 60 }
    ]);

    const result = await dashboardService.giro(90);

    expect(dashboardRepository.getGiroECobertura).toHaveBeenCalledWith(90);
    expect(result).toEqual([{ id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, giro: 0.5 }]);
    expect(result[0]).not.toHaveProperty('cobertura_dias');
  });
});

describe('cobertura', () => {
  test('delegates to the repository with the given período and trims to cobertura-relevant fields', async () => {
    dashboardRepository.getGiroECobertura.mockResolvedValue([
      { id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, giro: 0.5, cobertura_dias: 60 }
    ]);

    const result = await dashboardService.cobertura(30);

    expect(dashboardRepository.getGiroECobertura).toHaveBeenCalledWith(30);
    expect(result).toEqual([{ id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, cobertura_dias: 60 }]);
    expect(result[0]).not.toHaveProperty('giro');
  });
});

test('margem delegates to precosRepository', async () => {
  precosRepository.listarMargemPorProdutoECanal.mockResolvedValue([
    { produto_id: 1, nome: 'X', custo: '10.00', canal: 'loja_fisica', preco_venda: '20.00', margem_percentual: '50.00' }
  ]);

  const result = await dashboardService.margem();

  expect(result).toEqual([
    { produto_id: 1, nome: 'X', custo: '10.00', canal: 'loja_fisica', preco_venda: '20.00', margem_percentual: '50.00' }
  ]);
});

describe('resumo', () => {
  test('combines curva_abc, giro, cobertura, and margem for the given período', async () => {
    dashboardRepository.getCurvaABC.mockResolvedValue([{ id: 1, curva: 'A' }]);
    dashboardRepository.getGiroECobertura.mockResolvedValue([
      { id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, giro: 0.5, cobertura_dias: 60 }
    ]);
    precosRepository.listarMargemPorProdutoECanal.mockResolvedValue([{ produto_id: 1, canal: 'loja_fisica' }]);

    const result = await dashboardService.resumo(45);

    expect(dashboardRepository.getGiroECobertura).toHaveBeenCalledWith(45);
    expect(result).toEqual({
      curva_abc: [{ id: 1, curva: 'A' }],
      giro: [{ id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, giro: 0.5 }],
      cobertura: [{ id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, cobertura_dias: 60 }],
      margem: [{ produto_id: 1, canal: 'loja_fisica' }]
    });
  });
});
