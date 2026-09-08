const {
  criarDespesaFixaSchema,
  atualizarDespesaFixaSchema
} = require('../../src/validations/despesasFixasValidation');

describe('criarDespesaFixaSchema', () => {
  const valid = { categoria: 'estrutural', descricao: 'Aluguel da loja', valor: 3500, vigencia_inicio: '2026-08-01' };

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

  test('rejects a missing vigencia_inicio', () => {
    const { vigencia_inicio, ...rest } = valid;
    const result = criarDespesaFixaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects an invalid vigencia_inicio format', () => {
    const result = criarDespesaFixaSchema.safeParse({ ...valid, vigencia_inicio: '01/08/2026' });
    expect(result.success).toBe(false);
  });

  test('accepts a missing vigencia_fim (em vigor, sem data de término)', () => {
    const result = criarDespesaFixaSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data.vigencia_fim).toBeUndefined();
  });

  test('accepts vigencia_fim explicitly null', () => {
    const result = criarDespesaFixaSchema.safeParse({ ...valid, vigencia_fim: null });
    expect(result.success).toBe(true);
  });

  test('accepts vigencia_fim on or after vigencia_inicio', () => {
    expect(criarDespesaFixaSchema.safeParse({ ...valid, vigencia_fim: '2026-08-01' }).success).toBe(true);
    expect(criarDespesaFixaSchema.safeParse({ ...valid, vigencia_fim: '2026-12-31' }).success).toBe(true);
  });

  test('rejects vigencia_fim before vigencia_inicio', () => {
    const result = criarDespesaFixaSchema.safeParse({ ...valid, vigencia_fim: '2026-07-31' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Data de fim de vigência não pode ser antes do início');
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

  test('vigencia_inicio is optional on update', () => {
    expect(atualizarDespesaFixaSchema.safeParse({ vigencia_fim: '2026-12-31' }).success).toBe(true);
  });

  test('accepts vigencia_fim explicitly null (clears "em vigor" back to open-ended)', () => {
    expect(atualizarDespesaFixaSchema.safeParse({ vigencia_fim: null }).success).toBe(true);
  });

  test('rejects vigencia_fim before vigencia_inicio when both are provided together', () => {
    const result = atualizarDespesaFixaSchema.safeParse({ vigencia_inicio: '2026-08-01', vigencia_fim: '2026-07-31' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Data de fim de vigência não pode ser antes do início');
  });

  test('does not reject vigencia_fim alone against a vigencia_inicio not present in this payload (validated by the DB CHECK instead)', () => {
    expect(atualizarDespesaFixaSchema.safeParse({ vigencia_fim: '2026-01-01' }).success).toBe(true);
  });
});
