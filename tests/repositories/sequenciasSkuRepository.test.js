const sequenciasSkuRepository = require('../../src/repositories/sequenciasSkuRepository');

describe('incrementarContador', () => {
  test('upserts and returns the incremented contador, using the given client', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ contador: 3 }] }) };

    const contador = await sequenciasSkuRepository.incrementarContador('BR-01', 9, client);

    expect(contador).toBe(3);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO sequencias_sku');
    expect(sql).toContain('ON CONFLICT (empresa_id, chave_combinacao)');
    expect(sql).toContain('contador = sequencias_sku.contador + 1');
    expect(params).toEqual([9, 'BR-01']);
  });
});
