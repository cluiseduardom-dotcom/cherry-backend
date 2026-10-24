const { calcularComissaoCentavos, liberadoProporcionalCentavos, centavosParaReais, validarPercentual } = require('../../src/utils/comissao');

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

describe('liberadoProporcionalCentavos', () => {
  test('proporcional ao pago, arredondando para BAIXO', () => {
    expect(liberadoProporcionalCentavos(1000, 4000, 10000)).toBe(400);
    expect(liberadoProporcionalCentavos(1000, 3333, 10000)).toBe(333);
    expect(liberadoProporcionalCentavos(1000, 6666, 10000)).toBe(666);
  });

  test('pago integral (ou acima) libera exatamente o valor; nada pago não libera', () => {
    expect(liberadoProporcionalCentavos(1000, 10000, 10000)).toBe(1000);
    expect(liberadoProporcionalCentavos(1000, 12000, 10000)).toBe(1000);
    expect(liberadoProporcionalCentavos(1000, 0, 10000)).toBe(0);
  });

  test('total zero não divide por zero', () => {
    expect(liberadoProporcionalCentavos(0, 0, 0)).toBe(0);
  });

  test('nunca libera mais que o valor, para qualquer pago possível (varredura)', () => {
    for (let pago = 0; pago <= 10000; pago += 37) {
      const liberado = liberadoProporcionalCentavos(777, pago, 10000);
      expect(liberado).toBeGreaterThanOrEqual(0);
      expect(liberado).toBeLessThanOrEqual(777);
    }
  });

  test('é monótono: pagar mais nunca libera menos', () => {
    let anterior = 0;
    for (let pago = 0; pago <= 10000; pago += 13) {
      const atual = liberadoProporcionalCentavos(1234, pago, 10000);
      expect(atual).toBeGreaterThanOrEqual(anterior);
      anterior = atual;
    }
  });

  test('entradas inválidas são recusadas', () => {
    expect(() => liberadoProporcionalCentavos(-1, 0, 100)).toThrow();
    expect(() => liberadoProporcionalCentavos(10, 1.5, 100)).toThrow();
    expect(() => liberadoProporcionalCentavos(10, 0, NaN)).toThrow();
  });
});
