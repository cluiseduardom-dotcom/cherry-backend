const AppError = require('../errors/AppError');

// Number(x) aceita 'Infinity' e devolve NaN para lixo; `NaN <= 0` e
// `Infinity > 0` enganam checagens manuais. Aqui só passa número finito.
function numeroFinito(valor, mensagem) {
    if (valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '')) {
        throw new AppError(mensagem, 400);
    }

    const numero = Number(valor);

    if (!Number.isFinite(numero)) {
        throw new AppError(mensagem, 400);
    }

    return numero;
}

function inteiroNoIntervalo(valor, { min, max }, mensagem) {
    const numero = Number(valor);

    if (!Number.isInteger(numero) || numero < min || numero > max) {
        throw new AppError(mensagem, 400);
    }

    return numero;
}

module.exports = { numeroFinito, inteiroNoIntervalo };
