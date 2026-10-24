const { criarConferenciaSchema, acertoQuerySchema } = require('../../src/validations/conferenciasEstoqueValidation');

const item = { produto_id: 1, quantidade_contada: 3 };

describe('criarConferenciaSchema', () => {
    test('aceita contagem válida e assume aplicar_ajuste = false', () => {
        const r = criarConferenciaSchema.safeParse({ itens: [item] });
        expect(r.success).toBe(true);
        expect(r.data.aplicar_ajuste).toBe(false);
    });

    test('aceita contagem zero', () => {
        expect(criarConferenciaSchema.safeParse({ itens: [{ produto_id: 1, quantidade_contada: 0 }] }).success).toBe(true);
    });

    test.each([
        ['sem itens', { itens: [] }],
        ['contagem negativa', { itens: [{ produto_id: 1, quantidade_contada: -1 }] }],
        ['contagem fracionada', { itens: [{ produto_id: 1, quantidade_contada: 1.5 }] }],
        ['produto repetido', { itens: [item, item] }],
        ['campo extra', { itens: [item], empresa_id: 9 }],
        ['campo extra no item', { itens: [{ ...item, local_id: 2 }] }],
        ['aplicar_ajuste não booleano', { itens: [item], aplicar_ajuste: 'sim' }],
        ['mais de 200 itens', { itens: Array.from({ length: 201 }, (_, i) => ({ produto_id: i + 1, quantidade_contada: 1 })) }]
    ])('recusa %s', (_, corpo) => {
        expect(criarConferenciaSchema.safeParse(corpo).success).toBe(false);
    });
});

describe('acertoQuerySchema', () => {
    test('aceita ausência de data e data real', () => {
        expect(acertoQuerySchema.safeParse({}).success).toBe(true);
        expect(acertoQuerySchema.safeParse({ desde: '2026-02-28' }).success).toBe(true);
    });

    test.each(['ontem', '2026-13-01', '2026-02-30', '26-01-01'])('recusa %s', (desde) => {
        expect(acertoQuerySchema.safeParse({ desde }).success).toBe(false);
    });
});
