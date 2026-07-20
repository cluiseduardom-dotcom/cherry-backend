const { loginSchema, registerSchema } = require('../../src/validations/authValidation');

describe('loginSchema', () => {
  test('accepts a valid login payload', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', senha: 'senha123' });
    expect(result.success).toBe(true);
  });

  test('rejects an invalid email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', senha: 'senha123' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Email inválido');
  });

  test('rejects an empty senha', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', senha: '' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Senha é obrigatória');
  });
});

describe('registerSchema', () => {
  const valid = { nome: 'Fulano', email: 'a@b.com', senha: 'senha123', papel: 'vendedor' };

  test('accepts a valid register payload', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  test.each(['admin', 'vendedor', 'estoquista'])('accepts papel "%s"', (papel) => {
    expect(registerSchema.safeParse({ ...valid, papel }).success).toBe(true);
  });

  test('rejects an invalid papel', () => {
    const result = registerSchema.safeParse({ ...valid, papel: 'superadmin' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Papel inválido');
  });

  test('rejects a password shorter than 6 characters', () => {
    const result = registerSchema.safeParse({ ...valid, senha: '123' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Senha deve ter no mínimo 6 caracteres');
  });

  test('rejects a missing nome', () => {
    const { nome, ...rest } = valid;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
