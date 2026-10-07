const AppError = require('../errors/AppError');

const PROFUNDIDADE_MAXIMA = 20;

// JSON.parse('1e999') devolve Infinity. Zod já rejeita, mas validações manuais
// (Number(x) > 0) deixariam passar; barramos na borda, para todas as rotas.
function contemNumeroNaoFinito(valor, profundidade = 0) {
    if (typeof valor === 'number') return !Number.isFinite(valor);
    if (valor === null || typeof valor !== 'object') return false;
    if (profundidade > PROFUNDIDADE_MAXIMA) return true;

    return Object.values(valor).some((item) => contemNumeroNaoFinito(item, profundidade + 1));
}

module.exports = (req, res, next) => {
    if (contemNumeroNaoFinito(req.body)) {
        return next(new AppError('Corpo da requisição contém número inválido', 400));
    }

    return next();
};
module.exports.contemNumeroNaoFinito = contemNumeroNaoFinito;
