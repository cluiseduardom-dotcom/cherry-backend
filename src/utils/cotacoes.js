// Regras PURAS da comparação de cotações (sem banco). Valor efetivo de uma oferta = quantidade × preço − desconto.
// "Melhor" = menor preço efetivo por unidade; empate fica com a oferta registrada primeiro. Nunca decide pelo usuário:
// só aponta, e quem escolhe o fornecedor de cada item é a pessoa (ver gerar pedidos).

const centavos = (v) => Math.round(Number(v) * 100);

// total da linha, em reais, sem erro de ponto flutuante (6 casas no preço: preço por grama não perde centavo)
function totalDaOferta(oferta) {
    const bruto = Math.round(Number(oferta.quantidade_ofertada) * Number(oferta.preco_unitario) * 100);

    return Math.max(0, bruto - centavos(oferta.desconto ?? 0)) / 100;
}

function precoEfetivoUnitario(oferta) {
    const q = Number(oferta.quantidade_ofertada);

    return q > 0 ? totalDaOferta(oferta) / q : Infinity;
}

// ofertas: [{ id, cotacao_item_id, cotacao_fornecedor_id, quantidade_ofertada, preco_unitario, desconto }]
// → { [cotacao_item_id]: cotacao_fornecedor_id da melhor oferta }
function melhorPorItem(ofertas) {
    const melhor = new Map();

    for (const o of [...ofertas].sort((a, b) => Number(a.id) - Number(b.id))) {
        const atual = melhor.get(o.cotacao_item_id);

        if (!atual || precoEfetivoUnitario(o) < precoEfetivoUnitario(atual)) melhor.set(o.cotacao_item_id, o);
    }

    return Object.fromEntries([...melhor.entries()].map(([item, o]) => [item, o.cotacao_fornecedor_id]));
}

module.exports = { totalDaOferta, precoEfetivoUnitario, melhorPorItem };
