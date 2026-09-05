const { criarFichaTecnicaSchema } = require('../../src/validations/fichasTecnicasValidation');

describe('criarFichaTecnicaSchema', () => {
  const valid = {
    itens: [
      { insumo_produto_id: 2, quantidade_necessaria: 2 },
      { insumo_produto_id: 3, quantidade_necessaria: 1 }
    ]
  };

  test('accepts a valid ficha técnica payload', () => {
    expect(criarFichaTecnicaSchema.safeParse(valid).success).toBe(true);
  });

  test('rejects an empty itens array', () => {
    const result = criarFichaTecnicaSchema.safeParse({ itens: [] });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('A ficha técnica deve ter ao menos um item');
  });

  test('rejects a missing itens field', () => {
    const result = criarFichaTecnicaSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('rejects an invalid insumo_produto_id', () => {
    const result = criarFichaTecnicaSchema.safeParse({
      itens: [{ insumo_produto_id: -1, quantidade_necessaria: 1 }]
    });
    expect(result.success).toBe(false);
  });

  test('rejects quantidade_necessaria <= 0', () => {
    const result = criarFichaTecnicaSchema.safeParse({
      itens: [{ insumo_produto_id: 2, quantidade_necessaria: 0 }]
    });
    expect(result.success).toBe(false);
  });

  test('rejects an unexpected item field', () => {
    const result = criarFichaTecnicaSchema.safeParse({
      itens: [{ insumo_produto_id: 2, quantidade_necessaria: 1, custo_unitario: 10 }]
    });
    expect(result.success).toBe(false);
  });

  test('rejects an unexpected top-level field', () => {
    const result = criarFichaTecnicaSchema.safeParse({ ...valid, produto_id: 1 });
    expect(result.success).toBe(false);
  });

  test('rejects a payload with two items sharing the same insumo_produto_id', () => {
    const result = criarFichaTecnicaSchema.safeParse({
      itens: [
        { insumo_produto_id: 2, quantidade_necessaria: 1 },
        { insumo_produto_id: 2, quantidade_necessaria: 3 }
      ]
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Insumo repetido na ficha técnica');
  });
});
