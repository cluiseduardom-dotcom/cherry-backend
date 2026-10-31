const { registrarMovimentacaoSchema } = require('../../src/validations/estoqueValidation');

const base = { tipo: 'saida', quantidade: 10, motivo_codigo: 'perda' };

describe('registrarMovimentacaoSchema', () => {
  test.each([
    ['entrada', 'estoque_inicial'],
    ['saida', 'perda'],
    ['ajuste', 'contagem']
  ])('accepts a valid %s payload with motivo %s', (tipo, motivo_codigo) => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo, quantidade: 10, motivo_codigo });
    expect(result.success).toBe(true);
  });

  test('rejects an invalid tipo', () => {
    const result = registrarMovimentacaoSchema.safeParse({ ...base, tipo: 'transferencia' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Tipo inválido');
  });

  test('rejects a negative quantidade', () => {
    expect(registrarMovimentacaoSchema.safeParse({ ...base, quantidade: -1 }).success).toBe(false);
  });

  test('rejects quantidade = 0 for entrada and saida', () => {
    const entrada = registrarMovimentacaoSchema.safeParse({ tipo: 'entrada', quantidade: 0, motivo_codigo: 'estoque_inicial' });
    expect(entrada.success).toBe(false);
    expect(entrada.error.issues[0].message).toBe('Quantidade deve ser maior que zero');
    expect(registrarMovimentacaoSchema.safeParse({ ...base, quantidade: 0 }).success).toBe(false);
  });

  test('accepts quantidade = 0 for ajuste (zeroing out stock)', () => {
    expect(registrarMovimentacaoSchema.safeParse({ tipo: 'ajuste', quantidade: 0, motivo_codigo: 'contagem' }).success).toBe(true);
  });

  test('rejects a non-integer quantidade', () => {
    expect(registrarMovimentacaoSchema.safeParse({ ...base, quantidade: 1.5 }).success).toBe(false);
  });

  test('requires a motivo_codigo', () => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo: 'saida', quantidade: 1 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Motivo é obrigatório');
  });

  test('ignores the legacy free-text motivo: it is not accepted in place of motivo_codigo', () => {
    expect(registrarMovimentacaoSchema.safeParse({ tipo: 'entrada', quantidade: 5, motivo: 'Reposição' }).success).toBe(false);
  });

  test('rejects a motivo that belongs to another tipo', () => {
    const result = registrarMovimentacaoSchema.safeParse({ tipo: 'entrada', quantidade: 5, motivo_codigo: 'perda' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Motivo inválido para este tipo de movimentação');
  });

  test('entrada has no generic "reposição" reason: stock arrives by Compra or Recebimento', () => {
    expect(registrarMovimentacaoSchema.safeParse({ tipo: 'entrada', quantidade: 5, motivo_codigo: 'reposicao' }).success).toBe(false);
    expect(registrarMovimentacaoSchema.safeParse({ tipo: 'entrada', quantidade: 5, motivo_codigo: 'compra' }).success).toBe(false);
  });

  test.each([
    [{ tipo: 'entrada', motivo_codigo: 'recebimento_sem_compra' }],
    [{ tipo: 'saida', motivo_codigo: 'outro' }],
    [{ tipo: 'ajuste', motivo_codigo: 'correcao' }]
  ])('requires a observacao for %j', (extra) => {
    expect(registrarMovimentacaoSchema.safeParse({ quantidade: 5, ...extra }).success).toBe(false);
    expect(registrarMovimentacaoSchema.safeParse({ quantidade: 5, ...extra, observacao: 'ab' }).success).toBe(false);
    expect(registrarMovimentacaoSchema.safeParse({ quantidade: 5, ...extra, observacao: 'Bonificação do fornecedor' }).success).toBe(true);
  });

  test('limits the observacao to 200 characters', () => {
    expect(registrarMovimentacaoSchema.safeParse({ ...base, observacao: 'x'.repeat(201) }).success).toBe(false);
  });
});
