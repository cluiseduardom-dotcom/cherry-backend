jest.mock('../../src/repositories/sequenciasSkuRepository');
jest.mock('../../src/repositories/configuracoesSkuRepository');

const sequenciasSkuRepository = require('../../src/repositories/sequenciasSkuRepository');
const configuracoesSkuRepository = require('../../src/repositories/configuracoesSkuRepository');
const skuService = require('../../src/services/skuService');

const configuracao = {
  id: 10,
  tipo_sku: 'alfanumerico',
  separador: '',
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
});

describe('montarChaveCombinacao', () => {
  test('joins normalized codes with a stable internal separator', () => {
    expect(skuService.montarChaveCombinacao(['BR', '01'])).toBe('BR-01');
  });
});

describe('formatarSku', () => {
  test('formats configured SKU without a separator', () => {
    expect(skuService.formatarSku(['BR', '01'], 7, configuracao)).toBe('BR01007');
  });

  test('formats configured SKU with prefix, separator, suffix and sequence size', () => {
    const config = {
      ...configuracao,
      separador: '-',
      prefixo: 'P',
      sufixo: 'X',
      tamanho_sequencia: 4
    };

    expect(skuService.formatarSku(['BR', '01'], 7, config)).toBe('P-BR-01-0007-X');
  });

  test('does not truncate sequences above the configured width', () => {
    expect(skuService.formatarSku(['BR'], 1000, configuracao)).toBe('BR1000');
  });
});

describe('montarSegmentos', () => {
  test('uses the configured order instead of the old letter-first rule', () => {
    const categorias = [
      { nivel: 1, codigo: '02' },
      { nivel: 2, codigo: 'OU' }
    ];

    expect(skuService.montarSegmentos(categorias, configuracao)).toEqual(['02', 'OU']);
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
  test('builds the key from configured segments, increments atomically, and formats the SKU', async () => {
    sequenciasSkuRepository.incrementarContador.mockResolvedValue(2);

    const sku = await skuService.gerar(
      [{ nivel: 1, codigo: 'BR' }, { nivel: 2, codigo: '01' }],
      9,
      {}
    );

    expect(sequenciasSkuRepository.incrementarContador).toHaveBeenCalledWith(
      'BR-01',
      9,
      10,
      1,
      {}
    );
    expect(sku.sku).toBe('BR01002');
    expect(sku.configuracao.id).toBe(10);
  });

  test('rejects a code incompatible with numeric SKU configuration', async () => {
    const numeric = { ...configuracao, tipo_sku: 'numerico' };
    configuracoesSkuRepository.buscarAtiva.mockResolvedValue(numeric);

    await expect(
      skuService.gerar([{ nivel: 1, codigo: 'BR' }], 9, {})
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
