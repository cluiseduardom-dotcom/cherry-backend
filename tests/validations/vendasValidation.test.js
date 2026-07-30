const { criarVendaSchema } = require('../../src/validations/vendasValidation');

describe('criarVendaSchema', () => {
  const valid = {
    cliente_id: 1,
    canal: 'loja_fisica',
    itens: [{ produto_id: 1, quantidade: 2 }]
  };

  test('accepts a valid venda payload', () => {
    expect(criarVendaSchema.safeParse(valid).success).toBe(true);
  });

  test('accepts an omitted cliente_id (cliente is optional)', () => {
    const { cliente_id, ...rest } = valid;
    expect(criarVendaSchema.safeParse(rest).success).toBe(true);
  });

  test('accepts an omitted canal (defaults are applied downstream)', () => {
    const { canal, ...rest } = valid;
    expect(criarVendaSchema.safeParse(rest).success).toBe(true);
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
      itens: [{ produto_id: 1, quantidade: 0 }]
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Quantidade deve ser maior que zero');
  });

  test('rejects an invalid produto_id inside an item', () => {
    const result = criarVendaSchema.safeParse({
      ...valid,
      itens: [{ produto_id: -1, quantidade: 1 }]
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Produto inválido');
  });

  test('rejects a client-supplied preco_unitario (price is never accepted from the client)', () => {
    const result = criarVendaSchema.safeParse({
      ...valid,
      itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 999 }]
    });
    expect(result.success).toBe(false);
  });

  test('rejects an unexpected top-level field', () => {
    const result = criarVendaSchema.safeParse({ ...valid, total: 999 });
    expect(result.success).toBe(false);
  });

  test('accepts multiple itens', () => {
    const result = criarVendaSchema.safeParse({
      cliente_id: 1,
      itens: [
        { produto_id: 1, quantidade: 1 },
        { produto_id: 2, quantidade: 3 }
      ]
    });
    expect(result.success).toBe(true);
  });

  test('accepts an omitted forma_pagamento (defaults to à vista downstream)', () => {
    expect(criarVendaSchema.safeParse(valid).success).toBe(true);
  });

  test('accepts forma_pagamento a_vista without dias_prazo', () => {
    const result = criarVendaSchema.safeParse({ ...valid, forma_pagamento: 'a_vista' });
    expect(result.success).toBe(true);
  });

  test('accepts forma_pagamento prazo with dias_prazo', () => {
    const result = criarVendaSchema.safeParse({ ...valid, forma_pagamento: 'prazo', dias_prazo: 30 });
    expect(result.success).toBe(true);
  });

  test('rejects forma_pagamento prazo without dias_prazo', () => {
    const result = criarVendaSchema.safeParse({ ...valid, forma_pagamento: 'prazo' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Informe dias_prazo para vendas a prazo');
  });

  test('rejects an invalid forma_pagamento', () => {
    const result = criarVendaSchema.safeParse({ ...valid, forma_pagamento: 'boleto' });
    expect(result.success).toBe(false);
  });

  test('rejects dias_prazo <= 0', () => {
    const result = criarVendaSchema.safeParse({ ...valid, forma_pagamento: 'prazo', dias_prazo: 0 });
    expect(result.success).toBe(false);
  });
});
