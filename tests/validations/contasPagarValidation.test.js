const {
  criarContaPagarSchema,
  atualizarContaPagarSchema,
  listarContasPagarSchema
} = require('../../src/validations/contasPagarValidation');

describe('criarContaPagarSchema', () => {
  const valid = { descricao: 'Aluguel da loja', valor: 1500, data_vencimento: '2026-08-10' };

  test('accepts a valid conta a pagar payload', () => {
    const result = criarContaPagarSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('accepts optional fields (fornecedor, categoria, observacao)', () => {
    const result = criarContaPagarSchema.safeParse({
      ...valid,
      fornecedor: 'Imobiliária XYZ',
      categoria: 'Aluguel',
      observacao: 'Vencimento todo dia 10'
    });
    expect(result.success).toBe(true);
  });

  test('rejects a missing descricao', () => {
    const { descricao, ...rest } = valid;
    const result = criarContaPagarSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Descrição é obrigatória');
  });

  test.each([undefined, -100, 0, 'abc'])('rejects valor = %p', (valor) => {
    const result = criarContaPagarSchema.safeParse({ ...valid, valor });
    expect(result.success).toBe(false);
  });

  test('rejects a missing data_vencimento', () => {
    const { data_vencimento, ...rest } = valid;
    const result = criarContaPagarSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects an invalid data_vencimento', () => {
    const result = criarContaPagarSchema.safeParse({ ...valid, data_vencimento: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  test('coerces a numeric string valor', () => {
    const result = criarContaPagarSchema.safeParse({ ...valid, valor: '250.50' });
    expect(result.success).toBe(true);
    expect(result.data.valor).toBe(250.5);
  });

  test('rejects unknown fields', () => {
    const result = criarContaPagarSchema.safeParse({ ...valid, status: 'pago' });
    expect(result.success).toBe(false);
  });
});

describe('atualizarContaPagarSchema', () => {
  test('accepts a partial update with a single field', () => {
    expect(atualizarContaPagarSchema.safeParse({ valor: 200 }).success).toBe(true);
  });

  test('rejects an empty body', () => {
    const result = atualizarContaPagarSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Informe ao menos um campo para atualizar');
  });

  test('rejects an invalid valor when provided', () => {
    const result = atualizarContaPagarSchema.safeParse({ valor: -1 });
    expect(result.success).toBe(false);
  });

  test('rejects a status field (status only changes via pagar/cancelar actions)', () => {
    const result = atualizarContaPagarSchema.safeParse({ status: 'pago' });
    expect(result.success).toBe(false);
  });
});

describe('listarContasPagarSchema', () => {
  test('accepts an empty filter set', () => {
    expect(listarContasPagarSchema.safeParse({}).success).toBe(true);
  });

  test('accepts a valid status', () => {
    expect(listarContasPagarSchema.safeParse({ status: 'pendente' }).success).toBe(true);
  });

  test('rejects an invalid status', () => {
    const result = listarContasPagarSchema.safeParse({ status: 'quitada' });
    expect(result.success).toBe(false);
  });

  test('accepts a vencimento_de/vencimento_ate date range', () => {
    const result = listarContasPagarSchema.safeParse({ vencimento_de: '2026-01-01', vencimento_ate: '2026-12-31' });
    expect(result.success).toBe(true);
  });
});
