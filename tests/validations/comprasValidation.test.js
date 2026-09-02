const { criarCompraSchema, listarComprasSchema } = require('../../src/validations/comprasValidation');

describe('criarCompraSchema', () => {
  const valid = {
    fornecedor_id: 1,
    data_compra: '2026-08-10',
    itens: [{ produto_id: 1, quantidade: 2, custo_unitario: 10 }]
  };

  test('accepts a valid compra payload', () => {
    expect(criarCompraSchema.safeParse(valid).success).toBe(true);
  });

  test('accepts optional nota_fiscal', () => {
    const result = criarCompraSchema.safeParse({ ...valid, nota_fiscal: 'NF-12345' });
    expect(result.success).toBe(true);
  });

  test('rejects a missing fornecedor_id', () => {
    const { fornecedor_id, ...rest } = valid;
    const result = criarCompraSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Fornecedor inválido');
  });

  test('rejects an invalid fornecedor_id', () => {
    const result = criarCompraSchema.safeParse({ ...valid, fornecedor_id: -1 });
    expect(result.success).toBe(false);
  });

  test('rejects a missing data_compra', () => {
    const { data_compra, ...rest } = valid;
    const result = criarCompraSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects an invalid data_compra', () => {
    const result = criarCompraSchema.safeParse({ ...valid, data_compra: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  test('keeps data_compra as a plain YYYY-MM-DD string (never coerced to Date)', () => {
    const result = criarCompraSchema.safeParse(valid);
    expect(result.data.data_compra).toBe('2026-08-10');
    expect(typeof result.data.data_compra).toBe('string');
  });

  test('rejects an empty itens array', () => {
    const result = criarCompraSchema.safeParse({ ...valid, itens: [] });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('A compra deve ter ao menos um item');
  });

  test('rejects a missing itens field', () => {
    const { itens, ...rest } = valid;
    const result = criarCompraSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects quantidade <= 0', () => {
    const result = criarCompraSchema.safeParse({ ...valid, itens: [{ produto_id: 1, quantidade: 0, custo_unitario: 10 }] });
    expect(result.success).toBe(false);
  });

  test('rejects custo_unitario <= 0', () => {
    const result = criarCompraSchema.safeParse({ ...valid, itens: [{ produto_id: 1, quantidade: 1, custo_unitario: 0 }] });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Custo unitário deve ser maior que zero');
  });

  test('rejects an invalid produto_id inside an item', () => {
    const result = criarCompraSchema.safeParse({ ...valid, itens: [{ produto_id: -1, quantidade: 1, custo_unitario: 10 }] });
    expect(result.success).toBe(false);
  });

  test('accepts an omitted forma_pagamento (defaults to à vista downstream)', () => {
    expect(criarCompraSchema.safeParse(valid).success).toBe(true);
  });

  test('accepts forma_pagamento a_vista without dias_prazo', () => {
    const result = criarCompraSchema.safeParse({ ...valid, forma_pagamento: 'a_vista' });
    expect(result.success).toBe(true);
  });

  test('accepts forma_pagamento prazo with dias_prazo', () => {
    const result = criarCompraSchema.safeParse({ ...valid, forma_pagamento: 'prazo', dias_prazo: 30 });
    expect(result.success).toBe(true);
  });

  test('rejects forma_pagamento prazo without dias_prazo', () => {
    const result = criarCompraSchema.safeParse({ ...valid, forma_pagamento: 'prazo' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Informe dias_prazo para compras a prazo');
  });

  test('rejects an invalid forma_pagamento', () => {
    const result = criarCompraSchema.safeParse({ ...valid, forma_pagamento: 'boleto' });
    expect(result.success).toBe(false);
  });

  test('rejects dias_prazo <= 0', () => {
    const result = criarCompraSchema.safeParse({ ...valid, forma_pagamento: 'prazo', dias_prazo: 0 });
    expect(result.success).toBe(false);
  });

  test('rejects an unexpected top-level field', () => {
    const result = criarCompraSchema.safeParse({ ...valid, valor_total: 999 });
    expect(result.success).toBe(false);
  });

  test('rejects a client-supplied status', () => {
    const result = criarCompraSchema.safeParse({ ...valid, status: 'cancelado' });
    expect(result.success).toBe(false);
  });
});

describe('listarComprasSchema', () => {
  test('accepts an empty filter set', () => {
    expect(listarComprasSchema.safeParse({}).success).toBe(true);
  });

  test('accepts a valid fornecedor_id filter', () => {
    expect(listarComprasSchema.safeParse({ fornecedor_id: 1 }).success).toBe(true);
  });

  test('rejects an invalid fornecedor_id filter', () => {
    const result = listarComprasSchema.safeParse({ fornecedor_id: -1 });
    expect(result.success).toBe(false);
  });

  test('accepts a data_de/data_ate range', () => {
    const result = listarComprasSchema.safeParse({ data_de: '2026-01-01', data_ate: '2026-12-31' });
    expect(result.success).toBe(true);
  });

  test('rejects an invalid data_de', () => {
    const result = listarComprasSchema.safeParse({ data_de: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});
