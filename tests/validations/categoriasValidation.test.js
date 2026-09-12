const { criarCategoriaSchema, atualizarCategoriaSchema } = require('../../src/validations/categoriasValidation');

describe('criarCategoriaSchema', () => {
  const valid = { nivel: 1, codigo: 'BR', nome: 'Brinco' };

  test('accepts a valid payload', () => {
    expect(criarCategoriaSchema.safeParse(valid).success).toBe(true);
  });

  test('accepts a single-character alphanumeric codigo', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, codigo: '1' }).success).toBe(true);
  });

  test('rejects a missing nivel', () => {
    const { nivel, ...semNivel } = valid;
    const result = criarCategoriaSchema.safeParse(semNivel);
    expect(result.success).toBe(false);
  });

  test('rejects a zero or negative nivel', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, nivel: 0 }).success).toBe(false);
    expect(criarCategoriaSchema.safeParse({ ...valid, nivel: -1 }).success).toBe(false);
  });

  test('rejects a missing codigo', () => {
    const { codigo, ...semCodigo } = valid;
    expect(criarCategoriaSchema.safeParse(semCodigo).success).toBe(false);
  });

  test('rejects a codigo longer than 3 characters', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, codigo: 'BRIN' }).success).toBe(false);
  });

  test('rejects an empty codigo', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, codigo: '' }).success).toBe(false);
  });

  test('rejects a codigo with non-alphanumeric characters', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, codigo: 'A-B' }).success).toBe(false);
  });

  test('rejects a missing nome', () => {
    const { nome, ...semNome } = valid;
    expect(criarCategoriaSchema.safeParse(semNome).success).toBe(false);
  });

  test('rejects unknown fields', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, ativo: true }).success).toBe(false);
  });
});

describe('atualizarCategoriaSchema', () => {
  test('accepts a nome-only payload', () => {
    expect(atualizarCategoriaSchema.safeParse({ nome: 'Novo Nome' }).success).toBe(true);
  });

  test('rejects an empty nome', () => {
    expect(atualizarCategoriaSchema.safeParse({ nome: '' }).success).toBe(false);
  });

  test('rejects a missing nome', () => {
    expect(atualizarCategoriaSchema.safeParse({}).success).toBe(false);
  });

  test('rejects codigo in the body', () => {
    expect(atualizarCategoriaSchema.safeParse({ nome: 'X', codigo: 'BR' }).success).toBe(false);
  });

  test('rejects nivel in the body', () => {
    expect(atualizarCategoriaSchema.safeParse({ nome: 'X', nivel: 2 }).success).toBe(false);
  });
});
