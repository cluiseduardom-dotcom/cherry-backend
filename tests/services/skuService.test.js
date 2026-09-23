jest.mock('../../src/repositories/sequenciasSkuRepository');
jest.mock('../../src/repositories/configuracoesSkuRepository');

const sequenciasSkuRepository = require('../../src/repositories/sequenciasSkuRepository');
const configuracoesSkuRepository = require('../../src/repositories/configuracoesSkuRepository');
const skuService = require('../../src/services/skuService');

const configuracao = {
  id: 10,
  tipo_sku: 'numerico',
  separador: '-',
  prefixo: '',
  sufixo: '',
  tamanho_sequencia: 3,
  inicio_sequencia: 1,
  segmentos: [
    { nivel: 1, ordem: 1, nome: 'Família', obrigatorio: false, participa_sku: true },
    { nivel: 2, ordem: 2, nome: 'Material', obrigatorio: false, participa_sku: true }
  ]
};

beforeEach(() => {
  jest.clearAllMocks();
  configuracoesSkuRepository.buscarAtiva.mockResolvedValue(configuracao);
  configuracoesSkuRepository.buscarParaCategorias = jest.fn().mockResolvedValue(configuracao);
});

describe('montarChaveCombinacao', () => {
  test('joins normalized codes with a stable internal separator', () => {
    expect(skuService.montarChaveCombinacao(['BR', '01'])).toBe('BR-01');
  });
});

describe('formatarSku', () => {
  test('formats variable-length category codes with the configured separator', () => {
    expect(skuService.formatarSku(['COL', 'BO', 'FEM'], 1, configuracao)).toBe('COL-BO-FEM-001');
  });

  test('supports prefix, suffix and custom separator', () => {
    const config = {
      ...configuracao,
      separador: '_',
      prefixo: 'CH',
      sufixo: 'V1',
      tamanho_sequencia: 4
    };

    expect(skuService.formatarSku(['COL', '18K'], 7, config)).toBe('CH_COL_18K_0007_V1');
  });

  test('does not truncate sequences when they exceed the configured padding width', () => {
    expect(skuService.formatarSku(['COL'], 1000, configuracao)).toBe('COL-1000');
  });
});

describe('validarSeparador', () => {
  test('accepts the configured safe separators', () => {
    for (const separador of ['-', '_', '/', 'x', '*', '+']) {
      expect(skuService.validarSeparador(separador)).toBe(separador);
    }
  });

  test('rejects unsafe separators', () => {
    expect(() => skuService.validarSeparador('|')).toThrow('Separador de SKU não permitido');
  });
});

describe('montarSegmentos', () => {
  test('uses configured order and accepts variable-length alphanumeric codes', () => {
    const categorias = [
      { nivel: 1, codigo: 'COL' },
      { nivel: 2, codigo: '18K' }
    ];

    expect(skuService.montarSegmentos(categorias, configuracao)).toEqual(['COL', '18K']);
  });

  test('throws when a required level is missing', () => {
    const config = {
      ...configuracao,
      segmentos: [
        { nivel: 1, ordem: 1, nome: 'Família', obrigatorio: true, participa_sku: true }
      ]
    };

    expect(() => skuService.montarSegmentos([], config)).toThrow(
      'O nível 1 é obrigatório para gerar o SKU'
    );
  });

  test('ignores optional missing levels', () => {
    expect(skuService.montarSegmentos([{ nivel: 1, codigo: 'BR' }], configuracao)).toEqual(['BR']);
  });
});

describe('gerar', () => {
  test('resolves the pattern from product categories and increments atomically', async () => {
    sequenciasSkuRepository.incrementarContador.mockResolvedValue(2);

    const categorias = [
      { id: 11, nivel: 1, codigo: 'COL' },
      { id: 22, nivel: 2, codigo: 'BO' }
    ];

    const resultado = await skuService.gerar(categorias, 9, {});

    expect(configuracoesSkuRepository.buscarParaCategorias).toHaveBeenCalledWith([11, 22], 9, {});
    expect(sequenciasSkuRepository.incrementarContador).toHaveBeenCalledWith(
      'COL-BO',
      9,
      10,
      1,
      {}
    );
    expect(resultado.sku).toBe('COL-BO-002');
    expect(resultado.configuracao.id).toBe(10);
  });
});
