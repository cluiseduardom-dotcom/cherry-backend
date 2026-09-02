const { atualizarConfiguracaoFinanceiraSchema } = require('../../src/validations/configuracoesFinanceirasValidation');

describe('atualizarConfiguracaoFinanceiraSchema', () => {
  test('accepts a valid aliquota_imposto', () => {
    expect(atualizarConfiguracaoFinanceiraSchema.safeParse({ aliquota_imposto: 0.06 }).success).toBe(true);
  });

  test('accepts the boundaries 0 and 1', () => {
    expect(atualizarConfiguracaoFinanceiraSchema.safeParse({ aliquota_imposto: 0 }).success).toBe(true);
    expect(atualizarConfiguracaoFinanceiraSchema.safeParse({ aliquota_imposto: 1 }).success).toBe(true);
  });

  test('rejects a value above 1', () => {
    const result = atualizarConfiguracaoFinanceiraSchema.safeParse({ aliquota_imposto: 1.5 });
    expect(result.success).toBe(false);
  });

  test('rejects a negative value', () => {
    const result = atualizarConfiguracaoFinanceiraSchema.safeParse({ aliquota_imposto: -0.1 });
    expect(result.success).toBe(false);
  });

  test('rejects a missing aliquota_imposto', () => {
    const result = atualizarConfiguracaoFinanceiraSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('coerces a numeric string', () => {
    const result = atualizarConfiguracaoFinanceiraSchema.safeParse({ aliquota_imposto: '0.08' });
    expect(result.success).toBe(true);
    expect(result.data.aliquota_imposto).toBe(0.08);
  });

  test('rejects unknown fields', () => {
    const result = atualizarConfiguracaoFinanceiraSchema.safeParse({ aliquota_imposto: 0.06, outro: 1 });
    expect(result.success).toBe(false);
  });
});
