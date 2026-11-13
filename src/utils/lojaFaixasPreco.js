// Faixas de preço da Home ("Até R$ 30", "Até R$ 50"...), calculadas SOZINHAS a partir dos preços reais das peças à venda.
// Regra pura (sem banco), testável. Cortes em valores "redondos" para ler bem; cada faixa conta as peças reais que cabem nela.
const DEGRAUS = [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 5000];
const QUANTIS = [0.25, 0.5, 0.75];
const MINIMO_PECAS = 6;
const MINIMO_POR_FAIXA = 2;

const arredondarParaCima = (valor) => DEGRAUS.find((d) => d >= valor) ?? Math.ceil(valor / 1000) * 1000;

/**
 * @param {number[]} precos preços das peças disponíveis
 * @returns {{ate: number|null, quantidade: number}[]} até 3 faixas "até X" crescentes e, por último, "todas" (`ate: null`).
 *   Lista vazia = não mostrar (poucas peças, ou preços tão parecidos que faixas não ajudam a escolher).
 */
function calcularFaixasDePreco(precos) {
    const validos = (Array.isArray(precos) ? precos : []).map(Number).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
    const total = validos.length;

    if (total < MINIMO_PECAS) return [];

    const maior = validos[total - 1];
    const cortes = [...new Set(QUANTIS.map((q) => arredondarParaCima(validos[Math.min(total - 1, Math.ceil(q * total) - 1)])))]
        .filter((corte) => corte < maior)
        .sort((a, b) => a - b);

    const faixas = [];
    let anterior = 0;

    for (const corte of cortes) {
        const quantidade = validos.filter((p) => p <= corte).length;

        // Faixa que não traz peças novas (ou que cobre tudo) não ajuda a escolher.
        if (quantidade - anterior < MINIMO_POR_FAIXA || quantidade >= total) continue;

        faixas.push({ ate: corte, quantidade });
        anterior = quantidade;
    }

    return faixas.length >= 2 ? [...faixas, { ate: null, quantidade: total }] : [];
}

module.exports = { calcularFaixasDePreco, MINIMO_PECAS };
