const { listarContasReceberSchema } = require('../../src/validations/contasReceberValidation');

describe('listarContasReceberSchema', () => {
  test('accepts an empty filter set', () => {
    expect(listarContasReceberSchema.safeParse({}).success).toBe(true);
  });

  test('accepts a valid status', () => {
    expect(listarContasReceberSchema.safeParse({ status: 'pendente' }).success).toBe(true);
    expect(listarContasReceberSchema.safeParse({ status: 'recebido' }).success).toBe(true);
    expect(listarContasReceberSchema.safeParse({ status: 'cancelado' }).success).toBe(true);
  });

  test('rejects an invalid status', () => {
    const result = listarContasReceberSchema.safeParse({ status: 'pago' });
    expect(result.success).toBe(false);
  });

  test('accepts a vencimento_de/vencimento_ate date range', () => {
    const result = listarContasReceberSchema.safeParse({ vencimento_de: '2026-01-01', vencimento_ate: '2026-12-31' });
    expect(result.success).toBe(true);
  });

  test('rejects an invalid vencimento_de', () => {
    const result = listarContasReceberSchema.safeParse({ vencimento_de: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});
