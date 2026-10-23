const AppError = require('../errors/AppError');
const {
    reaisParaCentavos,
    calcularTaxaPlataformaCentavos,
    centavosParaReais
} = require('./taxaPlataforma');

// Cálculo da comissão do vendedor. Função pura: sem banco, sem Date.
//
// Reaproveita a aritmética inteira (BigInt, metade para cima, em centavos) já usada na
// taxa da plataforma, para que o arredondamento de dinheiro seja um só no sistema.
// Os testes cobrem os casos; aqui só validamos a entrada com mensagens de comissão.

function validarPercentual(percentual) {
    const numero = percentual === null || percentual === undefined || typeof percentual === 'boolean'
        || (typeof percentual === 'string' && percentual.trim() === '')
        ? NaN
        : Number(percentual);

    if (!Number.isFinite(numero) || numero < 0 || numero > 100) {
        throw new AppError('Percentual de comissão inválido', 500);
    }

    return numero;
}

// baseReais: number/string em reais (ex.: 95 ou '95.00'). Retorna centavos inteiros.
function calcularComissaoCentavos(baseReais, percentual) {
    const pct = validarPercentual(percentual);
    const baseCentavos = reaisParaCentavos(baseReais);

    return {
        base_centavos: baseCentavos,
        valor_centavos: calcularTaxaPlataformaCentavos(baseCentavos, pct)
    };
}

// Parte da comissão liberada pelo que já foi PAGO da venda: valor * pago / total, em
// centavos inteiros, arredondando para BAIXO (nunca libera centavo a mais). Pago >= total
// libera tudo exatamente; pago <= 0 não libera nada. Como o alvo é recalculado do zero a
// cada pagamento (e não somado parcela a parcela), o total liberado ao fim é sempre o
// valor exato da comissão, sem resto acumulado.
function liberadoProporcionalCentavos(valorCentavos, pagoCentavos, totalCentavos) {
    for (const parte of [valorCentavos, pagoCentavos, totalCentavos]) {
        if (!Number.isSafeInteger(parte) || parte < 0) {
            throw new AppError('Valores inválidos para liberar a comissão', 500);
        }
    }

    if (totalCentavos === 0 || pagoCentavos === 0) return 0;
    if (pagoCentavos >= totalCentavos) return valorCentavos;

    return Number((BigInt(valorCentavos) * BigInt(pagoCentavos)) / BigInt(totalCentavos));
}

module.exports = {
    liberadoProporcionalCentavos,
    reaisParaCentavos,
    calcularComissaoCentavos,
    centavosParaReais,
    validarPercentual
};
