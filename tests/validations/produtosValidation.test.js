const { criarProdutoSchema, ajustarPrecoSchema } = require('../../src/validations/produtosValidation');

describe('criarProdutoSchema', () => {
  test('accepts a valid produto payload', () => {
    const result = criarProdutoSchema.safeParse({ nome: 'Camiseta', preco_venda: 49.9, custo: 20 });
    expect(result.success).toBe(true);
  });

  test('rejects a missing nome', () => {
    const result = criarProdutoSchema.safeParse({ preco_venda: 10, custo: 5 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Nome é obrigatório');
  });

  test.each([undefined, -10, 0, 'abc'])('rejects preco_venda = %p', (preco_venda) => {
    const result = criarProdutoSchema.safeParse({ nome: 'X', preco_venda, custo: 5 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Preço de venda é obrigatório');
  });

  test.each([undefined, -5, 0])('rejects custo = %p', (custo) => {
    const result = criarProdutoSchema.safeParse({ nome: 'X', preco_venda: 10, custo });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Custo é obrigatório');
  });

  test('coerces numeric strings', () => {
    const result = criarProdutoSchema.safeParse({ nome: 'X', preco_venda: '10.5', custo: '5' });
    expect(result.success).toBe(true);
    expect(result.data.preco_venda).toBe(10.5);
  });
});

describe('ajustarPrecoSchema', () => {
  test('accepts a valid payload', () => {
    expect(ajustarPrecoSchema.safeParse({ id: 1, percentual: 0.1 }).success).toBe(true);
  });

  test('accepts the lower bound (-0.5)', () => {
    expect(ajustarPrecoSchema.safeParse({ id: 1, percentual: -0.5 }).success).toBe(true);
  });

  test('rejects a percentual below -0.5', () => {
    const result = ajustarPrecoSchema.safeParse({ id: 1, percentual: -0.6 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Percentual fora do limite');
  });

  test('rejects a percentual above 1', () => {
    const result = ajustarPrecoSchema.safeParse({ id: 1, percentual: 1.1 });
    expect(result.success).toBe(false);
  });

  test('rejects a non-positive id', () => {
    const result = ajustarPrecoSchema.safeParse({ id: 0, percentual: 0.1 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('ID inválido');
  });
});
