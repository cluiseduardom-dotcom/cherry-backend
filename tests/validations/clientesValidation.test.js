const { criarClienteSchema, atualizarClienteSchema } = require('../../src/validations/clientesValidation');

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

  test('accepts a full payload with all the new cadastral fields', () => {
    const result = criarClienteSchema.safeParse({
      nome: 'Cliente X',
      cpf_cnpj: '12345678901',
      cep: '01310-100',
      endereco: 'Av. Paulista',
      numero: '1000',
      complemento: 'Sala 10',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      uf: 'SP',
      data_nascimento: '1990-05-20',
      observacoes: 'Prefere contato por telefone'
    });
    expect(result.success).toBe(true);
  });

  test('accepts a valid 14-digit cnpj_cnpj with punctuation', () => {
    const result = criarClienteSchema.safeParse({ nome: 'X', cpf_cnpj: '12.345.678/0001-99' });
    expect(result.success).toBe(true);
  });

  test.each(['123', '123456789012', 'abc12345678'])(
    'rejects an invalid cpf_cnpj digit count: %p',
    (cpf_cnpj) => {
      const result = criarClienteSchema.safeParse({ nome: 'X', cpf_cnpj });
      expect(result.success).toBe(false);
    }
  );

  test('rejects a uf with more than 2 characters', () => {
    const result = criarClienteSchema.safeParse({ nome: 'X', uf: 'SPX' });
    expect(result.success).toBe(false);
  });

  test('rejects a data_nascimento outside YYYY-MM-DD format', () => {
    const result = criarClienteSchema.safeParse({ nome: 'X', data_nascimento: '20/05/1990' });
    expect(result.success).toBe(false);
  });

  test('rejects unknown fields', () => {
    const result = criarClienteSchema.safeParse({ nome: 'X', campo_inventado: true });
    expect(result.success).toBe(false);
  });
});

describe('atualizarClienteSchema', () => {
  test('accepts a partial update with a single field', () => {
    expect(atualizarClienteSchema.safeParse({ nome: 'Novo Nome' }).success).toBe(true);
  });

  test('accepts a partial update with only a cadastral field', () => {
    expect(atualizarClienteSchema.safeParse({ cidade: 'Rio de Janeiro' }).success).toBe(true);
  });

  test('accepts toggling ativo', () => {
    expect(atualizarClienteSchema.safeParse({ ativo: false }).success).toBe(true);
  });

  test('rejects an empty body', () => {
    const result = atualizarClienteSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Informe ao menos um campo para atualizar');
  });

  test('rejects an empty nome when provided', () => {
    const result = atualizarClienteSchema.safeParse({ nome: '' });
    expect(result.success).toBe(false);
  });

  test('rejects an invalid cpf_cnpj when provided', () => {
    const result = atualizarClienteSchema.safeParse({ cpf_cnpj: '123' });
    expect(result.success).toBe(false);
  });

  test('rejects unknown fields', () => {
    const result = atualizarClienteSchema.safeParse({ campo_inventado: true });
    expect(result.success).toBe(false);
  });
});
