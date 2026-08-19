jest.mock('../../src/repositories/pontoEquilibrioRepository');
jest.mock('../../src/repositories/despesasFixasRepository');
jest.mock('../../src/repositories/configuracoesFinanceirasRepository');

const pontoEquilibrioRepository = require('../../src/repositories/pontoEquilibrioRepository');
const despesasFixasRepository = require('../../src/repositories/despesasFixasRepository');
const configuracoesFinanceirasRepository = require('../../src/repositories/configuracoesFinanceirasRepository');
const pontoEquilibrioService = require('../../src/services/pontoEquilibrioService');

beforeEach(() => {
  jest.clearAllMocks();
});

function mockDados({ receita, custoVariavelProdutos, custoFixoTotal, aliquotaImposto }) {
  pontoEquilibrioRepository.somarReceita.mockResolvedValue(String(receita));
  pontoEquilibrioRepository.somarCustoVariavelProdutos.mockResolvedValue(String(custoVariavelProdutos));
  despesasFixasRepository.somarAtivas.mockResolvedValue(String(custoFixoTotal));
  configuracoesFinanceirasRepository.obterOuCriar.mockResolvedValue({ aliquota_imposto: String(aliquotaImposto) });
}

describe('calcular — caso normal (margem de contribuição positiva)', () => {
  test('computes receita, custo variável, margem e ponto de equilíbrio corretamente', async () => {
    mockDados({ receita: 20000, custoVariavelProdutos: 8000, custoFixoTotal: 6000, aliquotaImposto: 0.05 });

    const resultado = await pontoEquilibrioService.calcular(
      { dataInicio: '2026-08-01', dataFim: '2026-08-19' }, 9
    );

    expect(resultado.periodo).toEqual({ inicio: '2026-08-01', fim: '2026-08-19' });
    expect(resultado.receita).toBe(20000);
    expect(resultado.custoVariavelTotal).toBe(9000); // 8000 produtos + 1000 impostos (20000 * 0.05)
    expect(resultado.margemContribuicao).toBe(0.55); // (20000 - 9000) / 20000
    expect(resultado.custoFixoTotal).toBe(6000);
    expect(resultado.pontoEquilibrio).toBe(10909.09); // 6000 / 0.55, arredondado
    expect(resultado.faltaParaAtingir).toBe(0); // receita já passou do ponto de equilíbrio
    expect(resultado.inviavel).toBe(false);
  });

  test('faltaParaAtingir reflects the gap when receita is below the ponto de equilíbrio', async () => {
    mockDados({ receita: 5000, custoVariavelProdutos: 2000, custoFixoTotal: 6000, aliquotaImposto: 0 });

    const resultado = await pontoEquilibrioService.calcular(
      { dataInicio: '2026-08-01', dataFim: '2026-08-19' }, 9
    );

    // margemContribuicao = (5000 - 2000) / 5000 = 0.6 ; pontoEquilibrio = 6000 / 0.6 = 10000
    expect(resultado.margemContribuicao).toBe(0.6);
    expect(resultado.pontoEquilibrio).toBe(10000);
    expect(resultado.faltaParaAtingir).toBe(5000);
    expect(resultado.inviavel).toBe(false);
  });
});

describe('calcular — margem de contribuição zero ou negativa (inviável)', () => {
  test('returns inviavel: true and null pontoEquilibrio/faltaParaAtingir when custo variável supera a receita', async () => {
    mockDados({ receita: 10000, custoVariavelProdutos: 12000, custoFixoTotal: 6000, aliquotaImposto: 0 });

    const resultado = await pontoEquilibrioService.calcular(
      { dataInicio: '2026-08-01', dataFim: '2026-08-19' }, 9
    );

    expect(resultado.margemContribuicao).toBeLessThanOrEqual(0);
    expect(resultado.inviavel).toBe(true);
    expect(resultado.pontoEquilibrio).toBeNull();
    expect(resultado.faltaParaAtingir).toBeNull();
  });

  test('returns inviavel: true when margem de contribuição is exactly zero', async () => {
    mockDados({ receita: 10000, custoVariavelProdutos: 10000, custoFixoTotal: 6000, aliquotaImposto: 0 });

    const resultado = await pontoEquilibrioService.calcular(
      { dataInicio: '2026-08-01', dataFim: '2026-08-19' }, 9
    );

    expect(resultado.margemContribuicao).toBe(0);
    expect(resultado.inviavel).toBe(true);
    expect(resultado.pontoEquilibrio).toBeNull();
  });
});

describe('calcular — sem vendas no período', () => {
  test('treats receita = 0 as inviável instead of dividing by zero', async () => {
    mockDados({ receita: 0, custoVariavelProdutos: 0, custoFixoTotal: 6000, aliquotaImposto: 0.06 });

    const resultado = await pontoEquilibrioService.calcular(
      { dataInicio: '2026-08-01', dataFim: '2026-08-19' }, 9
    );

    expect(resultado.receita).toBe(0);
    expect(resultado.margemContribuicao).toBe(0);
    expect(resultado.inviavel).toBe(true);
    expect(resultado.pontoEquilibrio).toBeNull();
    expect(resultado.faltaParaAtingir).toBeNull();
  });
});

describe('calcular — sem despesas fixas cadastradas', () => {
  test('returns pontoEquilibrio = 0 when custoFixoTotal is 0 and margem is positive', async () => {
    mockDados({ receita: 20000, custoVariavelProdutos: 8000, custoFixoTotal: 0, aliquotaImposto: 0 });

    const resultado = await pontoEquilibrioService.calcular(
      { dataInicio: '2026-08-01', dataFim: '2026-08-19' }, 9
    );

    expect(resultado.custoFixoTotal).toBe(0);
    expect(resultado.pontoEquilibrio).toBe(0);
    expect(resultado.faltaParaAtingir).toBe(0);
    expect(resultado.inviavel).toBe(false);
  });
});
