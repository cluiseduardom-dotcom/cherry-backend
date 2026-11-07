const { calcularIndicadorInsumo, montarIndicadoresInsumos } = require('../../src/utils/indicadoresInsumos');

const base = { id: 1, sku: 'EMB-001', nome: 'Saquinho', unidade: 'un', saldo: 70, estoque_minimo: 10, consumo_periodo: 30, pendente: 0 };

describe('calcularIndicadorInsumo', () => {
    test('consumo médio diário e cobertura: saldo / (consumo / dias)', () => {
        const r = calcularIndicadorInsumo(base, 90);

        expect(r.consumo_medio_diario).toBe(0.33);
        expect(r.cobertura_dias).toBe(210); // 70 / (30 / 90)
        expect(r.repor).toBe(false);
        expect(r.motivos_reposicao).toEqual([]);
        expect(r.para_atingir_minimo).toBe(0);
    });

    test('sem consumo no período: cobertura nula, não infinita', () => {
        expect(calcularIndicadorInsumo({ ...base, consumo_periodo: 0 }, 90).cobertura_dias).toBeNull();
    });

    test('esgotado: repor, e a quantidade para sair do alerta é o mínimo', () => {
        const r = calcularIndicadorInsumo({ ...base, saldo: 0 }, 90);

        expect(r.motivos_reposicao).toEqual(['esgotado']);
        expect(r.cobertura_dias).toBe(0);
        expect(r.para_atingir_minimo).toBe(10);
    });

    test('saldo igual ou abaixo do mínimo: abaixo_minimo; acima: não', () => {
        expect(calcularIndicadorInsumo({ ...base, saldo: 10 }, 90).motivos_reposicao).toEqual(['abaixo_minimo']);
        expect(calcularIndicadorInsumo({ ...base, saldo: 4 }, 90).para_atingir_minimo).toBe(6);
        expect(calcularIndicadorInsumo({ ...base, saldo: 11 }, 90).repor).toBe(false);
    });

    test('mínimo 0 não gera alerta de mínimo (só esgotado ou pendência)', () => {
        expect(calcularIndicadorInsumo({ ...base, estoque_minimo: 0, saldo: 1 }, 90).repor).toBe(false);
    });

    test('pendência (venda sem baixar por falta de saldo) pede reposição e soma na quantidade', () => {
        const r = calcularIndicadorInsumo({ ...base, saldo: 50, pendente: 7 }, 90);

        expect(r.motivos_reposicao).toEqual(['pendencia']);
        expect(r.para_atingir_minimo).toBe(7);
    });

    test('combinação: esgotado com pendência e mínimo', () => {
        const r = calcularIndicadorInsumo({ ...base, saldo: 0, pendente: 3 }, 90);

        expect(r.motivos_reposicao).toEqual(['esgotado', 'pendencia']);
        expect(r.para_atingir_minimo).toBe(13);
    });
});

describe('montarIndicadoresInsumos', () => {
    test('totais por situação e consumo total', () => {
        const r = montarIndicadoresInsumos([
            base,
            { ...base, id: 2, saldo: 5 },
            { ...base, id: 3, saldo: 0, consumo_periodo: 0 },
            { ...base, id: 4, estoque_minimo: 0, consumo_periodo: 0, pendente: 2 }
        ], 90);

        expect(r.dias).toBe(90);
        expect(r.totais).toEqual({
            insumos_ativos: 4,
            esgotados: 1,
            abaixo_minimo: 1,
            com_pendencia: 1,
            a_repor: 3,
            sem_consumo_no_periodo: 2,
            consumo_total_periodo: 60
        });
    });
});
