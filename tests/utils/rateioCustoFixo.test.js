const { ratearCustoFixo } = require('../../src/utils/rateioCustoFixo');

describe('ratearCustoFixo', () => {
  test('a single despesa, período dentro de um único mês, sem restrição de vigência — proporcional aos dias', () => {
    // Agosto tem 31 dias; período de 01 a 10 = 10 dias.
    const despesas = [{ valor: 3100, vigencia_inicio: '2026-01-01', vigencia_fim: null }];

    const total = ratearCustoFixo(despesas, '2026-08-01', '2026-08-10');

    expect(total).toBe(1000); // 3100 * (10/31)
  });

  test('período cruzando dois meses — soma de dois segmentos proporcionais (15/08–15/09: 17/31 + 15/30)', () => {
    const despesas = [{ valor: 3100, vigencia_inicio: '2026-01-01', vigencia_fim: null }];

    const total = ratearCustoFixo(despesas, '2026-08-15', '2026-09-15');

    // 3100 * (17/31) + 3100 * (15/30) = 1700 + 1550
    expect(total).toBe(3250);
  });

  test('vigência começando no meio do período — conta só a partir da vigência', () => {
    // Período 01–31 de agosto (31 dias); vigência começa dia 21 (11 dias: 21..31).
    const despesas = [{ valor: 3100, vigencia_inicio: '2026-08-21', vigencia_fim: null }];

    const total = ratearCustoFixo(despesas, '2026-08-01', '2026-08-31');

    expect(total).toBe(1100); // 3100 * (11/31)
  });

  test('vigência terminando no meio do período — conta só até a vigência', () => {
    // Período 01–31 de agosto; vigência termina dia 10 (10 dias: 01..10).
    const despesas = [{ valor: 3100, vigencia_inicio: '2026-01-01', vigencia_fim: '2026-08-10' }];

    const total = ratearCustoFixo(despesas, '2026-08-01', '2026-08-31');

    expect(total).toBe(1000); // 3100 * (10/31)
  });

  test('vigência fora do período (termina antes dele começar) não contribui', () => {
    const despesas = [{ valor: 3100, vigencia_inicio: '2026-01-01', vigencia_fim: '2026-07-31' }];

    const total = ratearCustoFixo(despesas, '2026-08-01', '2026-08-31');

    expect(total).toBe(0);
  });

  test('fevereiro bissexto (29 dias) usado corretamente como dias_no_mes', () => {
    // 2028 é bissexto. Período 01–29 de fevereiro = mês inteiro.
    const despesas = [{ valor: 2900, vigencia_inicio: '2028-01-01', vigencia_fim: null }];

    const total = ratearCustoFixo(despesas, '2028-02-01', '2028-02-29');

    expect(total).toBe(2900); // mês inteiro: 2900 * (29/29)
  });

  test('múltiplas despesas somadas corretamente', () => {
    const despesas = [
      { valor: 3100, vigencia_inicio: '2026-01-01', vigencia_fim: null }, // 10/31
      { valor: 1500, vigencia_inicio: '2026-01-01', vigencia_fim: null }  // 10/31
    ];

    const total = ratearCustoFixo(despesas, '2026-08-01', '2026-08-10');

    expect(total).toBe(1483.87); // 1000 + 483.87 (1500 * 10/31 = 483.870...)
  });

  test('lista vazia — retorna 0', () => {
    expect(ratearCustoFixo([], '2026-08-01', '2026-08-31')).toBe(0);
  });
});
