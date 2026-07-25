const { registrarMovimentacaoSchema } = require('../../src/validations/estoqueValidation');

describe('registrarMovimentacaoSchema', () => {
  test.each(['entrada', 'saida', 'ajuste'])('accepts a valid %s payload', (tipo) => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo, quantidade: 10 });
    expect(result.success).toBe(true);
  });

  test('rejects an invalid tipo', () => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo: 'transferencia', quantidade: 5 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Tipo inválido');
  });

  test('rejects a negative quantidade', () => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo: 'entrada', quantidade: -1 });
    expect(result.success).toBe(false);
  });

  test('rejects quantidade = 0 for entrada', () => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo: 'entrada', quantidade: 0 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Quantidade deve ser maior que zero');
  });

  test('rejects quantidade = 0 for saida', () => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo: 'saida', quantidade: 0 });
    expect(result.success).toBe(false);
  });

  test('accepts quantidade = 0 for ajuste (zeroing out stock)', () => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo: 'ajuste', quantidade: 0 });
    expect(result.success).toBe(true);
  });

  test('accepts an optional motivo', () => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo: 'entrada', quantidade: 5, motivo: 'Reposição' });
    expect(result.success).toBe(true);
  });

  test('rejects a non-integer quantidade', () => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo: 'entrada', quantidade: 1.5 });
    expect(result.success).toBe(false);
  });
});
