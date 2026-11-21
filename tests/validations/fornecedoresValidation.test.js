const {
  criarFornecedorSchema,
  atualizarFornecedorSchema
} = require('../../src/validations/fornecedoresValidation');

describe('criarFornecedorSchema', () => {
  const valid = { nome: 'Metais & Cia' };

  test('accepts a valid fornecedor payload with only nome', () => {
    const result = criarFornecedorSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('accepts optional fields (contato, telefone, email, cnpj_cpf, observacoes)', () => {
    const result = criarFornecedorSchema.safeParse({
      ...valid,
      contato: 'João da Silva',
      telefone: '11999999999',
      email: 'contato@metais.com',
      cnpj_cpf: '12.345.678/0001-99',
      observacoes: 'Fornecedor de folheados'
    });
    expect(result.success).toBe(true);
  });

  test('rejects a missing nome', () => {
    const result = criarFornecedorSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Nome é obrigatório');
  });

  test('rejects an empty nome', () => {
    const result = criarFornecedorSchema.safeParse({ nome: '' });
    expect(result.success).toBe(false);
  });

  test('rejects an invalid email', () => {
    const result = criarFornecedorSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  test.each(['123', '123456789012', '1234567890123456', 'abc12345678'])(
    'rejects an invalid cnpj_cpf digit count: %p',
    (cnpj_cpf) => {
      const result = criarFornecedorSchema.safeParse({ ...valid, cnpj_cpf });
      expect(result.success).toBe(false);
    }
  );

  test('accepts a valid 11-digit cpf', () => {
    const result = criarFornecedorSchema.safeParse({ ...valid, cnpj_cpf: '12345678901' });
    expect(result.success).toBe(true);
  });

  test('accepts a valid 14-digit cnpj with punctuation', () => {
    const result = criarFornecedorSchema.safeParse({ ...valid, cnpj_cpf: '12.345.678/0001-99' });
    expect(result.success).toBe(true);
  });

  test('rejects unknown fields', () => {
    const result = criarFornecedorSchema.safeParse({ ...valid, ativo: false });
    expect(result.success).toBe(false);
  });
});

describe('atualizarFornecedorSchema', () => {
  test('accepts a partial update with a single field', () => {
    expect(atualizarFornecedorSchema.safeParse({ nome: 'Novo Nome' }).success).toBe(true);
  });

  test('accepts toggling ativo', () => {
    expect(atualizarFornecedorSchema.safeParse({ ativo: false }).success).toBe(true);
  });

  test('rejects an empty body', () => {
    const result = atualizarFornecedorSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Informe ao menos um campo para atualizar');
  });

  test('rejects an empty nome when provided', () => {
    const result = atualizarFornecedorSchema.safeParse({ nome: '' });
    expect(result.success).toBe(false);
  });

  test('rejects an invalid cnpj_cpf when provided', () => {
    const result = atualizarFornecedorSchema.safeParse({ cnpj_cpf: '123' });
    expect(result.success).toBe(false);
  });
});

describe('cnpj_cpf aceita CNPJ alfanumérico (só o formato)', () => {
  const base = { nome: 'X' };
  const { criarFornecedorSchema } = require('../../src/validations/fornecedoresValidation');

  test.each(['12.345.678/0001-90', '12345678000190', '12ABC34501DE35', '12.ABC.345/01DE-35', '123.456.789-01'])('aceita %s', (valor) => {
    expect(criarFornecedorSchema.safeParse({ ...base, cnpj_cpf: valor }).success).toBe(true);
  });

  test('letras minúsculas do CNPJ alfanumérico são guardadas em maiúsculas, mantendo a pontuação', () => {
    expect(criarFornecedorSchema.parse({ ...base, cnpj_cpf: '12.abc.345/01de-35' }).cnpj_cpf).toBe('12.ABC.345/01DE-35');
    expect(criarFornecedorSchema.parse({ ...base, cnpj_cpf: '12345678000190' }).cnpj_cpf).toBe('12345678000190');
  });

  test.each(['123', '12ABC34501DE3A', '12ABC34501DE3', '12ABC34501DE355', 'ABCDEFGHIJK', '12@ABC34501DE35', ''])('recusa %s', (valor) => {
    expect(criarFornecedorSchema.safeParse({ ...base, cnpj_cpf: valor }).success).toBe(false);
  });
});
