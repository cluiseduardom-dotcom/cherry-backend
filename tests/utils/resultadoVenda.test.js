const { calcularResultado, percentual, arredondar } = require('../../src/utils/resultadoVenda');
const { baldes } = require('../../src/services/resultadoVendasService');

describe('calcularResultado', () => {
    test('bruto = receita − custo; líquido = bruto − comissão − impostos; % sobre a receita', () => {
        // receita 180, custo 80 -> bruto 100 (55,56%); imposto 10% = 18; líquido 100 − 18 − 18 = 64 (35,56%)
        expect(calcularResultado({ receita: 180, custo: 80, comissao: 18, aliquota: 0.1 })).toEqual({
            receita: 180, custo: 80, lucro_bruto: 100, margem_bruta_pct: 55.56,
            comissao: 18, impostos: 18, lucro_liquido: 64, margem_liquida_pct: 35.56
        });
    });

    test('aceita texto numérico do Postgres (NUMERIC volta como string)', () => {
        expect(calcularResultado({ receita: '100.00', custo: '30.00', comissao: '0.00', aliquota: '0.0600' }))
            .toMatchObject({ lucro_bruto: 70, impostos: 6, lucro_liquido: 64 });
    });

    test('prejuízo fica negativo, com % negativa', () => {
        expect(calcularResultado({ receita: 100, custo: 130 })).toMatchObject({ lucro_bruto: -30, margem_bruta_pct: -30, lucro_liquido: -30 });
    });

    test('sem receita não há %: null, nunca NaN/Infinity', () => {
        const r = calcularResultado({ receita: 0, custo: 0, comissao: 0, aliquota: 0.1 });

        expect(r).toMatchObject({ lucro_bruto: 0, lucro_liquido: 0, margem_bruta_pct: null, margem_liquida_pct: null });
        expect(percentual(10, 0)).toBeNull();
    });

    test('valor inválido conta como zero', () => {
        expect(calcularResultado({ receita: 'x', custo: undefined })).toMatchObject({ receita: 0, custo: 0, lucro_bruto: 0 });
    });

    test('arredonda em 2 casas sem erro de ponto flutuante', () => {
        expect(arredondar(1.005)).toBe(1.01);
        expect(calcularResultado({ receita: 0.1 + 0.2, custo: 0 }).receita).toBe(0.3);
    });
});

describe('baldes do período', () => {
    test('mês: recorta o primeiro e o último mês pelo período', () => {
        expect(baldes('2026-02-10', '2026-04-05', 'mes')).toEqual([
            { chave: '2026-02', de: '2026-02-10', ate: '2026-02-28' },
            { chave: '2026-03', de: '2026-03-01', ate: '2026-03-31' },
            { chave: '2026-04', de: '2026-04-01', ate: '2026-04-05' }
        ]);
    });

    test('mês: cruza a virada do ano', () => {
        expect(baldes('2026-12-15', '2027-01-10', 'mes').map((b) => b.chave)).toEqual(['2026-12', '2027-01']);
    });

    test('dia: um balde por dia, inclusive virada de mês', () => {
        expect(baldes('2026-02-27', '2026-03-02', 'dia').map((b) => b.chave)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    });
});
