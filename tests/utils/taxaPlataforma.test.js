const {
    reaisParaCentavos,
    calcularTaxaPlataformaCentavos,
    centavosParaReais
} = require('../../src/utils/taxaPlataforma');

describe('calcularTaxaPlataformaCentavos — 0,15% (percentual 0.1500)', () => {
    test('R$ 100,00 gera R$ 0,15', () => {
        expect(calcularTaxaPlataformaCentavos(10000, '0.1500')).toBe(15);
    });

    test('R$ 1,00 gera R$ 0,00: sem mínimo artificial de R$ 0,01', () => {
        expect(calcularTaxaPlataformaCentavos(100, '0.1500')).toBe(0);
    });

    test('total zero gera taxa zero', () => {
        expect(calcularTaxaPlataformaCentavos(0, '0.1500')).toBe(0);
    });

    test('arredonda metade para cima, em centavos', () => {
        // 334 * 0,0015 = 0,501 centavo -> 1
        expect(calcularTaxaPlataformaCentavos(334, '0.1500')).toBe(1);
        // 333 * 0,0015 = 0,4995 centavo -> 0
        expect(calcularTaxaPlataformaCentavos(333, '0.1500')).toBe(0);
        // exatamente meio centavo: 10000 * 0,00005 = 0,5 -> 1
        expect(calcularTaxaPlataformaCentavos(10000, '0.0050')).toBe(1);
    });

    test('sem máximo artificial: venda grande proporcional', () => {
        // R$ 999.999.999,99 a 0,15% = R$ 1.499.999,99985 -> R$ 1.500.000,00 (150.000.000 centavos)
        expect(calcularTaxaPlataformaCentavos(99999999999, '0.1500')).toBe(150000000);
    });

    test('não perde precisão onde Number perderia (total * percentual > 2^53)', () => {
        const total = 99999999999; // centavos
        const percentual = '99.9999'; // 999999 em 4 casas: produto ~1e17 > 2^53
        const esperado = Number((BigInt(total) * 999999n + 500000n) / 1000000n);

        expect(calcularTaxaPlataformaCentavos(total, percentual)).toBe(esperado);
    });

    test('aceita o percentual como string do NUMERIC do pg ou como number', () => {
        expect(calcularTaxaPlataformaCentavos(20000, '0.1500')).toBe(30);
        expect(calcularTaxaPlataformaCentavos(20000, 0.15)).toBe(30);
    });

    test('percentual 0 gera taxa 0 e 100 gera o próprio total', () => {
        expect(calcularTaxaPlataformaCentavos(12345, '0.0000')).toBe(0);
        expect(calcularTaxaPlataformaCentavos(12345, '100.0000')).toBe(12345);
    });

    test.each([['-1'], ['100.0001'], ['abc'], [''], [null], [undefined], [NaN], [Infinity], [true]])(
        'rejeita percentual inválido (%p) com erro 500',
        (percentual) => {
            expect(() => calcularTaxaPlataformaCentavos(10000, percentual)).toThrow(
                expect.objectContaining({ statusCode: 500 })
            );
        }
    );

    test.each([[-1], [1.5], [NaN], [Infinity], ['100'], [null], [Number.MAX_SAFE_INTEGER + 2]])(
        'rejeita total em centavos inválido (%p) com erro 500',
        (total) => {
            expect(() => calcularTaxaPlataformaCentavos(total, '0.1500')).toThrow(
                expect.objectContaining({ statusCode: 500 })
            );
        }
    );
});

describe('reaisParaCentavos', () => {
    test('converte reais com 2 casas sem resíduo de float', () => {
        expect(reaisParaCentavos(100)).toBe(10000);
        expect(reaisParaCentavos('100.00')).toBe(10000);
        expect(reaisParaCentavos(0.1 + 0.2)).toBe(30);
        expect(reaisParaCentavos(1.005)).toBe(101);
        expect(reaisParaCentavos(999999999.99)).toBe(99999999999);
    });

    test.each([[-0.01], [NaN], [Infinity], ['abc'], [undefined], [null], [''], [true]])('rejeita total inválido (%p) com 500', (valor) => {
        expect(() => reaisParaCentavos(valor)).toThrow(expect.objectContaining({ statusCode: 500 }));
    });
});

describe('centavosParaReais', () => {
    test('formata com 2 casas para o NUMERIC do banco', () => {
        expect(centavosParaReais(15)).toBe('0.15');
        expect(centavosParaReais(0)).toBe('0.00');
        expect(centavosParaReais(10000)).toBe('100.00');
        expect(centavosParaReais(99999999999)).toBe('999999999.99');
    });
});
