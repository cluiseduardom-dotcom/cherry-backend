const { calcularFaixasDePreco, MINIMO_PECAS } = require('../../src/utils/lojaFaixasPreco');

describe('calcularFaixasDePreco', () => {
    test('poucas peças: não mostra faixa nenhuma', () => {
        expect(calcularFaixasDePreco([])).toEqual([]);
        expect(calcularFaixasDePreco([10, 20, 30])).toEqual([]);
        expect(calcularFaixasDePreco(Array.from({ length: MINIMO_PECAS - 1 }, (_, i) => 10 + i))).toEqual([]);
    });

    test('catálogo típico: faixas "até X" em valores redondos, crescentes, e "todas" no fim, com contagens reais', () => {
        const precos = [15, 18, 22, 25, 28, 30, 35, 39, 45, 52, 60, 75, 90, 120];
        const faixas = calcularFaixasDePreco(precos);

        expect(faixas.at(-1)).toEqual({ ate: null, quantidade: precos.length });
        expect(faixas.length).toBeGreaterThanOrEqual(3);
        for (const f of faixas.slice(0, -1)) {
            expect(f.quantidade).toBe(precos.filter((p) => p <= f.ate).length);
            expect([10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 250, 300]).toContain(f.ate);
        }
        const cortes = faixas.slice(0, -1).map((f) => f.ate);
        expect([...cortes].sort((a, b) => a - b)).toEqual(cortes);
        expect(new Set(cortes).size).toBe(cortes.length);
    });

    test('cada faixa traz ao menos 2 peças novas e nenhuma cobre o catálogo inteiro', () => {
        const precos = [15, 18, 22, 25, 28, 30, 35, 39, 45, 52, 60, 75, 90, 120];
        const faixas = calcularFaixasDePreco(precos);
        let anterior = 0;

        for (const f of faixas.slice(0, -1)) {
            expect(f.quantidade - anterior).toBeGreaterThanOrEqual(2);
            expect(f.quantidade).toBeLessThan(precos.length);
            anterior = f.quantidade;
        }
    });

    test('preços todos iguais ou quase iguais: esconde (faixas não ajudam a escolher)', () => {
        expect(calcularFaixasDePreco(Array(10).fill(45))).toEqual([]);
        expect(calcularFaixasDePreco([44, 45, 45, 45, 45, 46, 46, 46])).toEqual([]);
    });

    test('ignora valores inválidos (zero, negativo, texto, NaN) e aceita texto numérico', () => {
        const base = [15, 18, 22, 25, 28, 30, 35, 39, 45, 52];
        const comLixo = [...base, 0, -5, 'abc', NaN, null, undefined];

        expect(calcularFaixasDePreco(comLixo)).toEqual(calcularFaixasDePreco(base));
        expect(calcularFaixasDePreco(base.map(String))).toEqual(calcularFaixasDePreco(base));
    });

    test('entrada que não é lista: vazio', () => {
        expect(calcularFaixasDePreco(undefined)).toEqual([]);
        expect(calcularFaixasDePreco('x')).toEqual([]);
    });

    test('catálogo de joias caras: cortes maiores (não fica preso em R$ 30)', () => {
        const faixas = calcularFaixasDePreco([180, 220, 260, 310, 380, 450, 520, 640, 780, 950]);

        expect(faixas.slice(0, -1).every((f) => f.ate >= 200)).toBe(true);
    });
});
