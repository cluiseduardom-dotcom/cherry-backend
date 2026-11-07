const sequenciasSkuRepository = require('../../src/repositories/sequenciasSkuRepository');

describe('incrementarContador', () => {
  test('upserts and returns the incremented contador, using the given client', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ contador: 3 }] }) };

    const contador = await sequenciasSkuRepository.incrementarContador('BR-01', 9, 4, 1, client);

    expect(contador).toBe(3);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO sequencias_sku');
    expect(sql).toContain('ON CONFLICT (empresa_id, configuracao_id, chave_combinacao)');
    expect(sql).toContain('contador = sequencias_sku.contador + 1');
    expect(params).toEqual([9, 4, 'BR-01', 1]);
  });
});

describe('skuEmUso', () => {
  test('checks products and sku history (current and previous SKU), scoped by empresa_id', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };

    await expect(sequenciasSkuRepository.skuEmUso('ANE-BR-FEM-002', 9, client)).resolves.toBe(true);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('FROM produtos WHERE empresa_id = $1 AND sku = $2');
    expect(sql).toContain('FROM historico_sku');
    expect(sql).toContain('sku_anterior = $2');
    expect(params).toEqual([9, 'ANE-BR-FEM-002']);
  });

  test('returns false when nothing uses the SKU', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(sequenciasSkuRepository.skuEmUso('X-001', 9, client)).resolves.toBe(false);
  });
});
