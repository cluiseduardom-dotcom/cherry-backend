const { calcularCustoSku } = require('../../src/utils/custoSku');

describe('calcularCustoSku', () => {
    test('soma o custo do item com quantidade × custo de cada insumo', () => {
        const r = calcularCustoSku('15.00', [
            { quantidade: 1, custo_unitario: '0.80' },
            { quantidade: 2, custo_unitario: '0.35' }
        ]);

        expect(r.custo_item).toBe(15);
        expect(r.custo_insumos).toBe(1.5);
        expect(r.custo_total_sku).toBe(16.5);
        expect(r.itens.map((i) => i.subtotal_custo)).toEqual([0.8, 0.7]);
    });

    test('sem insumos o custo do SKU é o custo do item', () => {
        expect(calcularCustoSku(20, [])).toMatchObject({ custo_item: 20, custo_insumos: 0, custo_total_sku: 20 });
    });

    test('centavos exatos, sem erro de ponto flutuante (0,1 + 0,2)', () => {
        expect(calcularCustoSku(0.1, [{ quantidade: 1, custo_unitario: 0.2 }]).custo_total_sku).toBe(0.3);
    });

    test('valores inválidos são recusados', () => {
        expect(() => calcularCustoSku('abc', [])).toThrow(TypeError);
        expect(() => calcularCustoSku(-1, [])).toThrow(TypeError);
        expect(() => calcularCustoSku(1, [{ quantidade: 0, custo_unitario: 1 }])).toThrow(TypeError);
        expect(() => calcularCustoSku(1, [{ quantidade: 1.5, custo_unitario: 1 }])).toThrow(TypeError);
        expect(() => calcularCustoSku(1, [{ quantidade: 1, custo_unitario: NaN }])).toThrow(TypeError);
    });
});
