const { numeroFinito, inteiroNoIntervalo } = require('../../src/utils/numeros');

describe('numeroFinito', () => {
  test.each(['Infinity', '-Infinity', 'NaN', 'abc', '', '   ', null, undefined, Infinity, NaN, {}, '1e999'])(
    'rejeita %p com 400',
    (valor) => {
      expect(() => numeroFinito(valor, 'inválido')).toThrow(expect.objectContaining({ statusCode: 400, message: 'inválido' }));
    }
  );

  test.each([[10, 10], ['10.5', 10.5], [0, 0], ['-3', -3]])('aceita %p', (entrada, esperado) => {
    expect(numeroFinito(entrada, 'inválido')).toBe(esperado);
  });
});

describe('inteiroNoIntervalo', () => {
  const intervalo = { min: 1, max: 24 };

  test.each([0, 25, 1e9, 1.5, NaN, Infinity, 'abc', -1])('rejeita %p', (valor) => {
    expect(() => inteiroNoIntervalo(valor, intervalo, 'fora')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test.each([1, 12, 24, '6'])('aceita %p', (valor) => {
    expect(inteiroNoIntervalo(valor, intervalo, 'fora')).toBe(Number(valor));
  });
});
