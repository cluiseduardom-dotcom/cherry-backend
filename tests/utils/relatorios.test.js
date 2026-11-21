const {
    diasEntre,
    periodoAnterior,
    variacaoPct,
    classificarCurvaAbc,
    coberturaDias,
    diasDeAtraso,
    faixaDeAtraso
} = require('../../src/utils/relatorios');

describe('diasEntre e periodoAnterior', () => {
    test('conta os dois extremos', () => {
        expect(diasEntre('2026-03-01', '2026-03-01')).toBe(1);
        expect(diasEntre('2026-03-01', '2026-03-31')).toBe(31);
        expect(diasEntre('2026-02-01', '2026-03-01')).toBe(29);
    });

    test('período anterior tem o mesmo tamanho e termina na véspera', () => {
        expect(periodoAnterior('2026-03-01', '2026-03-31')).toEqual({ data_de: '2026-01-29', data_ate: '2026-02-28', dias: 31 });
        expect(periodoAnterior('2026-03-10', '2026-03-10')).toEqual({ data_de: '2026-03-09', data_ate: '2026-03-09', dias: 1 });
    });

    test('atravessa virada de ano', () => {
        expect(periodoAnterior('2026-01-01', '2026-01-31')).toEqual({ data_de: '2025-12-01', data_ate: '2025-12-31', dias: 31 });
    });
});

describe('variacaoPct', () => {
    test('calcula a variação', () => {
        expect(variacaoPct(110, 100)).toBe(10);
        expect(variacaoPct(90, 100)).toBe(-10);
        expect(variacaoPct(0, 100)).toBe(-100);
    });

    test('sem base de comparação não há percentual (nunca Infinity/NaN)', () => {
        expect(variacaoPct(5, 0)).toBeNull();
        expect(variacaoPct(0, 0)).toBeNull();
        expect(variacaoPct(NaN, 10)).toBeNull();
        expect(variacaoPct('x', 10)).toBeNull();
    });

    test('base negativa usa o módulo (sinal da variação segue o sentido real)', () => {
        expect(variacaoPct(-50, -100)).toBe(50);
    });
});

describe('classificarCurvaAbc', () => {
    test('A até 80%, B até 95%, C o resto; o item que cruza 80% ainda é A', () => {
        const itens = [{ id: 'a', receita: 70 }, { id: 'b', receita: 20 }, { id: 'c', receita: 6 }, { id: 'd', receita: 4 }];
        const r = classificarCurvaAbc(itens);

        expect(r.map((i) => [i.id, i.curva])).toEqual([['a', 'A'], ['b', 'A'], ['c', 'B'], ['d', 'C']]);
        expect(r[0].participacao_pct).toBe(70);
    });

    test('ordena por receita sem alterar a lista original', () => {
        const itens = [{ id: 'x', receita: 1 }, { id: 'y', receita: 9 }];

        expect(classificarCurvaAbc(itens).map((i) => i.id)).toEqual(['y', 'x']);
        expect(itens[0].id).toBe('x');
    });

    test('lista vazia e receita total zero não quebram', () => {
        expect(classificarCurvaAbc([])).toEqual([]);
        expect(classificarCurvaAbc([{ id: 'z', receita: 0 }])).toEqual([{ id: 'z', receita: 0, curva: 'C', participacao_pct: null }]);
    });
});

describe('coberturaDias', () => {
    test('estoque ÷ ritmo diário de venda', () => {
        expect(coberturaDias(20, 4, 31)).toBe(155);
        expect(coberturaDias(5, 3, 31)).toBe(51.7);
    });

    test('sem venda no período não há cobertura', () => {
        expect(coberturaDias(20, 0, 31)).toBeNull();
    });
});

describe('faixas de atraso', () => {
    test('dias de atraso: positivo = vencido', () => {
        expect(diasDeAtraso('2026-11-01', '2026-11-21')).toBe(20);
        expect(diasDeAtraso('2026-12-01', '2026-11-21')).toBe(-10);
        expect(diasDeAtraso('2026-11-21', '2026-11-21')).toBe(0);
    });

    test.each([
        [-10, 'a_vencer'],
        [0, 'a_vencer'],
        [1, 'ate_30'],
        [30, 'ate_30'],
        [31, 'de_31_a_60'],
        [60, 'de_31_a_60'],
        [61, 'de_61_a_90'],
        [90, 'de_61_a_90'],
        [91, 'acima_90'],
        [400, 'acima_90']
    ])('%i dias → %s', (dias, esperado) => {
        expect(faixaDeAtraso(dias).codigo).toBe(esperado);
    });
});
