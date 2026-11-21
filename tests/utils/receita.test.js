const { consumoDaReceita, maximoProduzivel, porUnidade } = require('../../src/utils/receita');

describe('consumoDaReceita (arredonda para cima, em unidade-base inteira)', () => {
    test('rendimento 1 é o consumo por unidade de sempre: quantidade × unidades', () => {
        expect(consumoDaReceita(2, 1, 3)).toBe(6);
        expect(consumoDaReceita(1, 1, 1000)).toBe(1000);
    });

    test('receita que rende várias unidades: 500 g para 12 unidades', () => {
        expect(consumoDaReceita(500, 12, 12)).toBe(500); // uma receita inteira
        expect(consumoDaReceita(500, 12, 24)).toBe(1000);
        expect(consumoDaReceita(500, 12, 10)).toBe(417); // 416,67 sobe para 417: nunca consome menos do que gastou
        expect(consumoDaReceita(500, 12, 1)).toBe(42); // 41,67
    });

    test('divisão exata não sobe por erro de ponto flutuante', () => {
        expect(consumoDaReceita(3, 10, 10)).toBe(3);
        expect(consumoDaReceita(7, 3, 3)).toBe(7);
        expect(consumoDaReceita(1000, 8, 8)).toBe(1000);
        expect(consumoDaReceita(250, 4, 400)).toBe(25000);
    });

    test('zero unidades consomem zero', () => {
        expect(consumoDaReceita(500, 12, 0)).toBe(0);
    });
});

describe('maximoProduzivel (maior quantidade cujo consumo cabe no saldo)', () => {
    test('rendimento 1 = floor(saldo ÷ consumo), igual ao comportamento antigo', () => {
        expect(maximoProduzivel(10, 2, 1)).toBe(5);
        expect(maximoProduzivel(5, 2, 1)).toBe(2);
        expect(maximoProduzivel(0, 2, 1)).toBe(0);
    });

    test('com rendimento: 1000 g de uma receita de 500 g para 12 unidades rendem 24', () => {
        expect(maximoProduzivel(1000, 500, 12)).toBe(24);
        expect(maximoProduzivel(999, 500, 12)).toBe(23);
        expect(maximoProduzivel(100, 500, 12)).toBe(2);
    });

    test('é consistente com o consumo: produzir o máximo cabe; uma a mais não cabe', () => {
        for (const [saldo, qtd, rend] of [[1000, 500, 12], [999, 500, 12], [37, 3, 7], [5, 2, 1], [1, 1, 1000], [12345, 250, 6]]) {
            const maximo = maximoProduzivel(saldo, qtd, rend);

            expect(consumoDaReceita(qtd, rend, maximo)).toBeLessThanOrEqual(saldo);
            expect(consumoDaReceita(qtd, rend, maximo + 1)).toBeGreaterThan(saldo);
        }
    });
});

describe('porUnidade', () => {
    test('consumo médio por unidade, para exibição', () => {
        expect(porUnidade(2, 1)).toBe(2);
        expect(porUnidade(500, 12)).toBeCloseTo(41.6667, 3);
    });
});

describe('rendimento ausente', () => {
    test('undefined e null valem 1 (comportamento antigo)', () => {
        expect(consumoDaReceita(2, undefined, 3)).toBe(6);
        expect(consumoDaReceita(2, null, 3)).toBe(6);
        expect(maximoProduzivel(10, 2, undefined)).toBe(5);
        expect(porUnidade(2, null)).toBe(2);
    });
});

