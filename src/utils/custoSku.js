// Custo total de um SKU = custo do item + soma(quantidade × custo unitário de cada insumo da ficha de venda).
// Soma em centavos inteiros para não acumular erro de ponto flutuante; devolve números com 2 casas.

function paraCentavos(valor) {
    const numero = Number(valor);

    if (!Number.isFinite(numero) || numero < 0) {
        throw new TypeError('Custo inválido');
    }

    return Math.round(numero * 100);
}

function deCentavos(centavos) {
    return centavos / 100;
}

// itens: [{ quantidade, custo_unitario }]
function calcularCustoSku(custoItem, itens) {
    const centavosItem = paraCentavos(custoItem);

    const linhas = itens.map((item) => {
        const quantidade = Number(item.quantidade);

        if (!Number.isInteger(quantidade) || quantidade <= 0) {
            throw new TypeError('Quantidade inválida');
        }

        const subtotal = quantidade * paraCentavos(item.custo_unitario);

        return { ...item, quantidade, subtotal_custo: deCentavos(subtotal), _centavos: subtotal };
    });

    const centavosInsumos = linhas.reduce((soma, linha) => soma + linha._centavos, 0);

    return {
        custo_item: deCentavos(centavosItem),
        custo_insumos: deCentavos(centavosInsumos),
        custo_total_sku: deCentavos(centavosItem + centavosInsumos),
        itens: linhas.map(({ _centavos, ...resto }) => resto)
    };
}

module.exports = { calcularCustoSku };
