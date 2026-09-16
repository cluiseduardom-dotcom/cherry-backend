jest.mock('../../src/repositories/dashboardRepository');
jest.mock('../../src/repositories/precosRepository');
jest.mock('../../src/repositories/niveisCategoriaRepository');

const dashboardRepository = require('../../src/repositories/dashboardRepository');
const precosRepository = require('../../src/repositories/precosRepository');
const niveisCategoriaRepository = require('../../src/repositories/niveisCategoriaRepository');
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

    const result = await dashboardService.giro(90, 9);

    expect(dashboardRepository.getGiroECobertura).toHaveBeenCalledWith(90, 9);
    expect(result).toEqual([{ id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, giro: 0.5 }]);
    expect(result[0]).not.toHaveProperty('cobertura_dias');
  });
});

describe('cobertura', () => {
  test('delegates to the repository with the given período and trims to cobertura-relevant fields', async () => {
    dashboardRepository.getGiroECobertura.mockResolvedValue([
      { id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, giro: 0.5, cobertura_dias: 60 }
    ]);

    const result = await dashboardService.cobertura(30, 9);

    expect(dashboardRepository.getGiroECobertura).toHaveBeenCalledWith(30, 9);
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

    const result = await dashboardService.resumo(45, 9);

    expect(dashboardRepository.getGiroECobertura).toHaveBeenCalledWith(45, 9);
    expect(result).toEqual({
      curva_abc: [{ id: 1, curva: 'A' }],
      giro: [{ id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, giro: 0.5 }],
      cobertura: [{ id: 1, nome: 'X', estoque_atual: 10, quantidade_vendida_periodo: 5, cobertura_dias: 60 }],
      margem: [{ produto_id: 1, canal: 'loja_fisica' }]
    });
  });
});

describe('giroCoberturaAgregado', () => {
  beforeEach(() => {
    dashboardRepository.getVendasEstoquePorProduto.mockResolvedValue([
      { id: 1, nome: 'Colar Prata', sku: 'BR001', estoque_atual: 10, quantidade_vendida_periodo: '5' },
      { id: 2, nome: 'Pingente Ouro', sku: null, estoque_atual: 0, quantidade_vendida_periodo: '20' }
    ]);
    dashboardRepository.getVinculosCategoriasProdutos.mockResolvedValue([
      { produto_id: 1, categoria_id: 10, nivel: 1, categoria_nome: 'Colares' }
    ]);
    dashboardRepository.getNiveisExistentes.mockResolvedValue([1]);
    niveisCategoriaRepository.listar.mockResolvedValue([{ nivel: 1, nome: 'família' }]);
  });

  test('monta o payload completo com total, por_nivel, top_giro e menor_giro', async () => {
    const resultado = await dashboardService.giroCoberturaAgregado(90, 9);

    expect(dashboardRepository.getVendasEstoquePorProduto).toHaveBeenCalledWith(90, 9);
    expect(dashboardRepository.getVinculosCategoriasProdutos).toHaveBeenCalledWith(9);
    expect(dashboardRepository.getNiveisExistentes).toHaveBeenCalledWith(9);
    expect(niveisCategoriaRepository.listar).toHaveBeenCalledWith(9);

    expect(resultado).toHaveProperty('total');
    expect(resultado).toHaveProperty('por_nivel');
    expect(resultado).toHaveProperty('top_giro');
    expect(resultado).toHaveProperty('menor_giro');
    expect(resultado).toHaveProperty('rupturas');
    expect(resultado.total.estoque_atual).toBe(10); // 10 + 0
    expect(resultado.total.quantidade_vendida_periodo).toBe(25); // 5 + 20
    expect(resultado.por_nivel).toEqual([
      expect.objectContaining({ nivel: 1, rotulo: 'família' })
    ]);
  });

  test('produto com estoque zerado e venda no período aparece em rupturas, mesmo fora dos rankings', async () => {
    const resultado = await dashboardService.giroCoberturaAgregado(90, 9);

    expect(resultado.rupturas).toEqual([
      { id: 2, nome: 'Pingente Ouro', sku: null, quantidade_vendida_periodo: 20, estoque_atual: 0 }
    ]);
    // produto 2 não entra em nenhum ranking de giro (giro não calculável com estoque 0)
    expect(resultado.top_giro.find((p) => p.id === 2)).toBeUndefined();
    expect(resultado.menor_giro.find((p) => p.id === 2)).toBeUndefined();
  });

  test('converte quantidade_vendida_periodo (string do SUM) e estoque_atual pra número antes de agregar', async () => {
    const resultado = await dashboardService.giroCoberturaAgregado(90, 9);

    // se não converter, '5' + '20' concatenaria como string "520"
    expect(resultado.total.quantidade_vendida_periodo).toBe(25);
  });

  test('produto com estoque zerado (giro null) não aparece em menor_giro', async () => {
    const resultado = await dashboardService.giroCoberturaAgregado(90, 9);

    expect(resultado.menor_giro.find((p) => p.id === 2)).toBeUndefined();
  });

  test('giro_alto_por_falta_de_estoque é relativo à venda do período', async () => {
    const resultado = await dashboardService.giroCoberturaAgregado(90, 9);

    const produto1 = resultado.top_giro.find((p) => p.id === 1);
    // estoque 10, vendido 5 => 10 >= 5 => false
    expect(produto1.giro_alto_por_falta_de_estoque).toBe(false);
  });
});
