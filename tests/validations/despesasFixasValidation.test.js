const {
  criarDespesaFixaSchema,
  atualizarDespesaFixaSchema
} = require('../../src/validations/despesasFixasValidation');

describe('criarDespesaFixaSchema', () => {
  const valid = { categoria: 'estrutural', descricao: 'Aluguel da loja', valor: 3500 };

  test('accepts a valid despesa fixa payload', () => {
    expect(criarDespesaFixaSchema.safeParse(valid).success).toBe(true);
  });

  test.each(['estrutural', 'pessoal', 'administrativa'])('accepts categoria = %s', (categoria) => {
    expect(criarDespesaFixaSchema.safeParse({ ...valid, categoria }).success).toBe(true);
  });

  test('rejects an invalid categoria', () => {
    const result = criarDespesaFixaSchema.safeParse({ ...valid, categoria: 'variavel' });
    expect(result.success).toBe(false);
  });

  test('rejects a missing descricao', () => {
    const { descricao, ...rest } = valid;
    const result = criarDespesaFixaSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Descrição é obrigatória');
  });

  test('accepts valor = 0', () => {
    expect(criarDespesaFixaSchema.safeParse({ ...valid, valor: 0 }).success).toBe(true);
  });

  test('rejects a negative valor', () => {
    const result = criarDespesaFixaSchema.safeParse({ ...valid, valor: -1 });
    expect(result.success).toBe(false);
  });

  test('coerces a numeric string valor', () => {
    const result = criarDespesaFixaSchema.safeParse({ ...valid, valor: '250.50' });
    expect(result.success).toBe(true);
    expect(result.data.valor).toBe(250.5);
  });

  test('rejects unknown fields', () => {
    const result = criarDespesaFixaSchema.safeParse({ ...valid, ativo: false });
    expect(result.success).toBe(false);
  });
});

describe('atualizarDespesaFixaSchema', () => {
  test('accepts a partial update with a single field', () => {
    expect(atualizarDespesaFixaSchema.safeParse({ valor: 200 }).success).toBe(true);
  });

  test('rejects an empty body', () => {
    const result = atualizarDespesaFixaSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Informe ao menos um campo para atualizar');
  });

  test('rejects an invalid categoria when provided', () => {
    const result = atualizarDespesaFixaSchema.safeParse({ categoria: 'variavel' });
    expect(result.success).toBe(false);
  });

  test('rejects a negative valor when provided', () => {
    const result = atualizarDespesaFixaSchema.safeParse({ valor: -1 });
    expect(result.success).toBe(false);
  });

  test('rejects an ativo field (ativo only changes via the toggle action)', () => {
    const result = atualizarDespesaFixaSchema.safeParse({ ativo: false });
    expect(result.success).toBe(false);
  });
});
