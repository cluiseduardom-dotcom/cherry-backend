const { calcularConsumosPrevistos } = require('../../src/repositories/vendaConsumosRepository');

describe('calcularConsumosPrevistos', () => {
    const fichas = [
        { ficha_venda_id: 10, produto_id: 1, insumo_produto_id: 100, quantidade: 1 },
        { ficha_venda_id: 10, produto_id: 1, insumo_produto_id: 101, quantidade: 2 },
        { ficha_venda_id: 11, produto_id: 2, insumo_produto_id: 100, quantidade: 1 }
    ];

    test('multiplica a quantidade vendida pela quantidade da ficha, por insumo', () => {
        expect(calcularConsumosPrevistos([{ produto_id: 1, quantidade: 3 }], fichas)).toEqual([
            { ficha_venda_id: 10, produto_id: 100, quantidade_prevista: 3 },
            { ficha_venda_id: 10, produto_id: 101, quantidade_prevista: 6 }
        ]);
    });

    test('mesmo produto em duas linhas da venda soma as quantidades', () => {
        const r = calcularConsumosPrevistos([{ produto_id: 1, quantidade: 1 }, { produto_id: 1, quantidade: 2 }], fichas);
        expect(r.find((l) => l.produto_id === 100).quantidade_prevista).toBe(3);
    });

    test('mesmo insumo em fichas de produtos diferentes gera uma linha por ficha, ordenadas por insumo', () => {
        const r = calcularConsumosPrevistos([{ produto_id: 2, quantidade: 4 }, { produto_id: 1, quantidade: 1 }], fichas);
        expect(r.filter((l) => l.produto_id === 100)).toEqual([
            { ficha_venda_id: 10, produto_id: 100, quantidade_prevista: 1 },
            { ficha_venda_id: 11, produto_id: 100, quantidade_prevista: 4 }
        ]);
        expect(r.map((l) => l.produto_id)).toEqual([100, 100, 101]);
    });

    test('produto sem ficha (ou ficha de produto não vendido) não consome nada', () => {
        expect(calcularConsumosPrevistos([{ produto_id: 9, quantidade: 5 }], fichas)).toEqual([]);
        expect(calcularConsumosPrevistos([], fichas)).toEqual([]);
    });
});
