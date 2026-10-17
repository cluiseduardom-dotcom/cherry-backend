const AppError = require('../errors/AppError');

// Cálculo da taxa interna da plataforma (VERTUMNO/GiroOne) sobre o total da venda.
// Função pura: sem banco, sem Date.
//
// Tudo em inteiros: o total vem em centavos e o percentual é guardado com 4
// casas (NUMERIC(7,4)), então 0,15% vira 1500. O produto
// total_centavos * percentual pode passar de 2^53 (total máximo da venda é
// ~1e11 centavos; percentual até 1e6) e perderia precisão em Number — por isso
// BigInt. Arredondamento: metade para cima, em centavos, sem mínimo nem máximo
// artificiais (R$ 1,00 a 0,15% = R$ 0,0015 -> R$ 0,00).

const ESCALA_PERCENTUAL = 10000; // 4 casas decimais
const DIVISOR = 1000000n; // 100 (percentual -> fração) * ESCALA_PERCENTUAL
const METADE = 500000n;

// Number(null) === 0 e Number(true) === 1: um valor ausente jamais pode virar
// 0% (ou 0 centavo) em silêncio.
function ausenteOuBooleano(valor) {
    return valor === null || valor === undefined || typeof valor === 'boolean'
        || (typeof valor === 'string' && valor.trim() === '');
}

function percentualParaInteiro(percentual) {
    const numero = ausenteOuBooleano(percentual) ? NaN : Number(percentual);

    if (!Number.isFinite(numero) || numero < 0 || numero > 100) {
        throw new AppError('Percentual da taxa da plataforma inválido', 500);
    }

    return Math.round(numero * ESCALA_PERCENTUAL);
}

// Reais (number/string com 2 casas) -> centavos inteiros. toPrecision(12)
// elimina o resíduo de float antes de arredondar (mesma técnica do PDV).
function reaisParaCentavos(valor) {
    const numero = ausenteOuBooleano(valor) ? NaN : Number(valor);

    if (!Number.isFinite(numero) || numero < 0) {
        throw new AppError('Total da venda inválido para o cálculo da taxa da plataforma', 500);
    }

    return Math.round(Number((numero * 100).toPrecision(12)));
}

function calcularTaxaPlataformaCentavos(totalCentavos, percentual) {
    if (!Number.isSafeInteger(totalCentavos) || totalCentavos < 0) {
        throw new AppError('Total da venda inválido para o cálculo da taxa da plataforma', 500);
    }

    const basisPoints = BigInt(percentualParaInteiro(percentual));

    return Number((BigInt(totalCentavos) * basisPoints + METADE) / DIVISOR);
}

function centavosParaReais(centavos) {
    return (centavos / 100).toFixed(2);
}

module.exports = {
    reaisParaCentavos,
    calcularTaxaPlataformaCentavos,
    centavosParaReais
};
