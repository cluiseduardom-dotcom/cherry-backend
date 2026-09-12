jest.mock('../../src/repositories/sequenciasSkuRepository');

const sequenciasSkuRepository = require('../../src/repositories/sequenciasSkuRepository');
const skuService = require('../../src/services/skuService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('montarChaveCombinacao', () => {
  test('orders by nivel ascending and joins with a dash', () => {
    const chave = skuService.montarChaveCombinacao([
      { nivel: 2, codigo: '01' },
      { nivel: 1, codigo: 'BR' }
    ]);
    expect(chave).toBe('BR-01');
  });

  test('uppercases codigo', () => {
    const chave = skuService.montarChaveCombinacao([{ nivel: 1, codigo: 'br' }]);
    expect(chave).toBe('BR');
  });
});

describe('formatarSku', () => {
  test('formats a single-nivel SKU with the sequence zero-padded to 3 digits', () => {
    expect(skuService.formatarSku([{ nivel: 1, codigo: 'BR' }], 7)).toBe('BR007');
  });

  test('formats a two-nivel SKU (letra + numero)', () => {
    const categorias = [{ nivel: 1, codigo: 'BR' }, { nivel: 2, codigo: '01' }];
    expect(skuService.formatarSku(categorias, 7)).toBe('BR01007');
  });

  test('puts codigos with a letter first, regardless of nivel order', () => {
    // nivel 1 is purely numeric, nivel 2 has a letter — letter block still comes first.
    const categorias = [{ nivel: 1, codigo: '02' }, { nivel: 2, codigo: 'OU' }];
    expect(skuService.formatarSku(categorias, 1)).toBe('OU02001');
  });

  test('does not pad beyond 3 digits once the sequence grows past 999', () => {
    expect(skuService.formatarSku([{ nivel: 1, codigo: 'BR' }], 1000)).toBe('BR1000');
    expect(skuService.formatarSku([{ nivel: 1, codigo: 'BR' }], 1001)).toBe('BR1001');
  });

  test('pads small sequence numbers to exactly 3 digits', () => {
    expect(skuService.formatarSku([{ nivel: 1, codigo: 'BR' }], 42)).toBe('BR042');
  });
});

describe('gerar', () => {
  test('builds the chave from the categorias, increments via the repository, and formats the sku', async () => {
    sequenciasSkuRepository.incrementarContador.mockResolvedValue(2);
    const client = {};

    const sku = await skuService.gerar([{ nivel: 1, codigo: 'BR' }, { nivel: 2, codigo: '01' }], 9, client);

    expect(sequenciasSkuRepository.incrementarContador).toHaveBeenCalledWith('BR-01', 9, client);
    expect(sku).toBe('BR01002');
  });

  test('the sequence continues (does not restart) across a soft-delete + recreate of the same codigo', async () => {
    // Same chave_combinacao text ("BR") is used whether the underlying categoria
    // row is id=5 (deleted) or a brand-new id=42 with the same codigo — this is
    // exactly the fix for the collision described in the design spec: the key
    // is anchored on codigo text, so gerar() never sees or needs the id at all.
    sequenciasSkuRepository.incrementarContador.mockResolvedValueOnce(1);
    const skuPrimeiraCategoria = await skuService.gerar([{ nivel: 1, codigo: 'BR' }], 9, {});
    expect(skuPrimeiraCategoria).toBe('BR001');

    sequenciasSkuRepository.incrementarContador.mockResolvedValueOnce(2);
    const skuCategoriaRecriada = await skuService.gerar([{ nivel: 1, codigo: 'BR' }], 9, {});
    expect(skuCategoriaRecriada).toBe('BR002');

    expect(sequenciasSkuRepository.incrementarContador).toHaveBeenNthCalledWith(1, 'BR', 9, {});
    expect(sequenciasSkuRepository.incrementarContador).toHaveBeenNthCalledWith(2, 'BR', 9, {});
  });
});
