const { criarVendaSchema } = require('../../src/validations/vendasValidation');

describe('criarVendaSchema', () => {
  const valid = {
    cliente_id: 1,
    itens: [{ produto_id: 1, quantidade: 2, preco_unitario: 10 }]
  };

  test('accepts a valid venda payload', () => {
    expect(criarVendaSchema.safeParse(valid).success).toBe(true);
  });

  test('rejects a missing cliente_id', () => {
    const { cliente_id, ...rest } = valid;
    const result = criarVendaSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Cliente inválido');
  });

  test('rejects an empty itens array', () => {
    const result = criarVendaSchema.safeParse({ ...valid, itens: [] });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('A venda deve ter ao menos um item');
  });

  test('rejects a missing itens field', () => {
    const { itens, ...rest } = valid;
    const result = criarVendaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects quantidade <= 0', () => {
    const result = criarVendaSchema.safeParse({
      ...valid,
      itens: [{ produto_id: 1, quantidade: 0, preco_unitario: 10 }]
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Quantidade deve ser maior que zero');
  });

  test('rejects preco_unitario <= 0', () => {
    const result = criarVendaSchema.safeParse({
      ...valid,
      itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 0 }]
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Preço unitário deve ser maior que zero');
  });

  test('rejects an invalid produto_id inside an item', () => {
    const result = criarVendaSchema.safeParse({
      ...valid,
      itens: [{ produto_id: -1, quantidade: 1, preco_unitario: 10 }]
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Produto inválido');
  });

  test('accepts multiple itens', () => {
    const result = criarVendaSchema.safeParse({
      cliente_id: 1,
      itens: [
        { produto_id: 1, quantidade: 1, preco_unitario: 10 },
        { produto_id: 2, quantidade: 3, preco_unitario: 5 }
      ]
    });
    expect(result.success).toBe(true);
  });
});
