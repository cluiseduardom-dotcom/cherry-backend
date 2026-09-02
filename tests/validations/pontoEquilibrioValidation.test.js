const { periodoPontoEquilibrioSchema } = require('../../src/validations/pontoEquilibrioValidation');

describe('periodoPontoEquilibrioSchema', () => {
  test('accepts an empty payload (defaults are applied by the controller)', () => {
    expect(periodoPontoEquilibrioSchema.safeParse({}).success).toBe(true);
  });

  test('accepts a valid data_inicio/data_fim range', () => {
    const result = periodoPontoEquilibrioSchema.safeParse({ data_inicio: '2026-08-01', data_fim: '2026-08-19' });
    expect(result.success).toBe(true);
  });

  test('rejects an invalid data_inicio', () => {
    const result = periodoPontoEquilibrioSchema.safeParse({ data_inicio: 'not-a-date', data_fim: '2026-08-19' });
    expect(result.success).toBe(false);
  });

  test('rejects data_inicio after data_fim', () => {
    const result = periodoPontoEquilibrioSchema.safeParse({ data_inicio: '2026-08-19', data_fim: '2026-08-01' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Data inicial não pode ser depois da data final');
  });

  test('accepts data_inicio equal to data_fim', () => {
    const result = periodoPontoEquilibrioSchema.safeParse({ data_inicio: '2026-08-19', data_fim: '2026-08-19' });
    expect(result.success).toBe(true);
  });
});
