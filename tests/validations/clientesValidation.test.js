const { criarClienteSchema } = require('../../src/validations/clientesValidation');

describe('criarClienteSchema', () => {
  test('accepts a payload with only nome', () => {
    const result = criarClienteSchema.safeParse({ nome: 'Cliente X' });
    expect(result.success).toBe(true);
  });

  test('accepts a full valid payload', () => {
    const result = criarClienteSchema.safeParse({
      nome: 'Cliente X',
      telefone: '11999999999',
      email: 'cliente@example.com'
    });
    expect(result.success).toBe(true);
  });

  test('rejects a missing nome', () => {
    const result = criarClienteSchema.safeParse({ telefone: '11999999999' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Nome é obrigatório');
  });

  test('rejects an empty nome', () => {
    const result = criarClienteSchema.safeParse({ nome: '' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Nome é obrigatório');
  });

  test('rejects an invalid email format', () => {
    const result = criarClienteSchema.safeParse({ nome: 'X', email: 'not-an-email' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Email inválido');
  });

  test('rejects a wrong-type email', () => {
    const result = criarClienteSchema.safeParse({ nome: 'X', email: 5 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Email inválido');
  });

  test('rejects a wrong-type telefone', () => {
    const result = criarClienteSchema.safeParse({ nome: 'X', telefone: 11999999999 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Telefone inválido');
  });
});
