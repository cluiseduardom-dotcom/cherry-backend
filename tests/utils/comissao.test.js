const { calcularComissaoCentavos, centavosParaReais, validarPercentual } = require('../../src/utils/comissao');

describe('calcularComissaoCentavos', () => {
  test('5% de R$ 200,00 = R$ 10,00', () => {
    expect(calcularComissaoCentavos(200, 5)).toEqual({ base_centavos: 20000, valor_centavos: 1000 });
  });

  test('aceita base em string com 2 casas', () => {
    expect(calcularComissaoCentavos('95.00', 10)).toEqual({ base_centavos: 9500, valor_centavos: 950 });
  });

  test('arredonda metade para cima em centavos (R$ 0,10 a 5% = 0,5 centavo -> 1 centavo)', () => {
    expect(calcularComissaoCentavos('0.10', 5).valor_centavos).toBe(1);
    expect(calcularComissaoCentavos('0.09', 5).valor_centavos).toBe(0);
  });

  test('aceita percentual fracionado com 4 casas (2,5%)', () => {
    expect(calcularComissaoCentavos(100, 2.5).valor_centavos).toBe(250);
  });

  test('0% gera comissão zero e 100% devolve a base inteira', () => {
    expect(calcularComissaoCentavos(80, 0).valor_centavos).toBe(0);
    expect(calcularComissaoCentavos(80, 100).valor_centavos).toBe(8000);
  });

  test('a comissão nunca passa da base', () => {
    const { base_centavos, valor_centavos } = calcularComissaoCentavos('33.33', 100);
    expect(valor_centavos).toBeLessThanOrEqual(base_centavos);
  });

  test.each([[-1], [101], [NaN], [null], [undefined], [''], [true], ['abc']])(
    'rejeita percentual inválido (%p)',
    (percentual) => {
      expect(() => calcularComissaoCentavos(100, percentual)).toThrow('Percentual de comissão inválido');
    }
  );

  test('rejeita base inválida (negativa ou ausente)', () => {
    expect(() => calcularComissaoCentavos(-1, 5)).toThrow();
    expect(() => calcularComissaoCentavos(null, 5)).toThrow();
  });
});

describe('validarPercentual / centavosParaReais', () => {
  test('devolve o número validado', () => {
    expect(validarPercentual('7.5')).toBe(7.5);
  });

  test('formata centavos em reais com 2 casas', () => {
    expect(centavosParaReais(1050)).toBe('10.50');
  });
});
