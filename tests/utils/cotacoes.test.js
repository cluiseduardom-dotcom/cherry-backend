const { totalDaOferta, precoEfetivoUnitario, melhorPorItem } = require('../../src/utils/cotacoes');

const oferta = (extra) => ({ id: 1, cotacao_item_id: 10, cotacao_fornecedor_id: 100, quantidade_ofertada: 10, preco_unitario: 12.5, desconto: 0, ...extra });

describe('totalDaOferta / precoEfetivoUnitario', () => {
    test('quantidade × preço − desconto, em centavos exatos', () => {
        expect(totalDaOferta(oferta())).toBe(125);
        expect(totalDaOferta(oferta({ desconto: 5 }))).toBe(120);
        expect(totalDaOferta(oferta({ quantidade_ofertada: 3, preco_unitario: 0.1 }))).toBe(0.3);
        expect(totalDaOferta(oferta({ desconto: 500 }))).toBe(0);
        expect(precoEfetivoUnitario(oferta({ desconto: 5 }))).toBe(12);
    });

    test('preço por grama (6 casas) não perde centavo: 350 g a R$ 0,045', () => {
        expect(totalDaOferta(oferta({ quantidade_ofertada: 350, preco_unitario: 0.045 }))).toBe(15.75);
    });
});

describe('melhorPorItem', () => {
    test('menor preço efetivo por unidade, considerando desconto e quantidade ofertada', () => {
        const ofertas = [
            oferta({ id: 1, cotacao_fornecedor_id: 100, preco_unitario: 12 }),
            oferta({ id: 2, cotacao_fornecedor_id: 200, preco_unitario: 13, desconto: 20 }), // 13×10−20 = 110 → 11/un.
            oferta({ id: 3, cotacao_fornecedor_id: 300, preco_unitario: 11.5, quantidade_ofertada: 4 }), // 11,5/un.
            oferta({ id: 4, cotacao_item_id: 11, cotacao_fornecedor_id: 300, preco_unitario: 5 })
        ];

        expect(melhorPorItem(ofertas)).toEqual({ 10: 200, 11: 300 });
    });

    test('empate fica com a oferta registrada primeiro; sem oferta não há melhor', () => {
        const ofertas = [oferta({ id: 5, cotacao_fornecedor_id: 200 }), oferta({ id: 2, cotacao_fornecedor_id: 100 })];

        expect(melhorPorItem(ofertas)).toEqual({ 10: 100 });
        expect(melhorPorItem([])).toEqual({});
    });
});
