const { definirPrecoSchema } = require('../../src/validations/precosValidation');

describe('definirPrecoSchema', () => {
  test('accepts markup_percentual alone', () => {
    expect(definirPrecoSchema.safeParse({ markup_percentual: 50 }).success).toBe(true);
  });

  test('accepts preco_venda alone', () => {
    expect(definirPrecoSchema.safeParse({ preco_venda: 99.9 }).success).toBe(true);
  });

  test('rejects an empty body', () => {
    const result = definirPrecoSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Informe markup_percentual ou preco_venda, não os dois');
  });

  test('rejects both markup_percentual and preco_venda together', () => {
    const result = definirPrecoSchema.safeParse({ markup_percentual: 50, preco_venda: 99.9 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Informe markup_percentual ou preco_venda, não os dois');
  });

  test('rejects a margem_percentual sent by the client, even alongside a valid field', () => {
    const result = definirPrecoSchema.safeParse({ markup_percentual: 50, margem_percentual: 33 });
    expect(result.success).toBe(false);
  });

  test('rejects a non-positive preco_venda', () => {
    const result = definirPrecoSchema.safeParse({ preco_venda: 0 });
    expect(result.success).toBe(false);
  });

  test('coerces numeric strings', () => {
    const result = definirPrecoSchema.safeParse({ markup_percentual: '50' });
    expect(result.success).toBe(true);
    expect(result.data.markup_percentual).toBe(50);
  });
});
