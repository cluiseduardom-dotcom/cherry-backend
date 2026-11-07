const AppError = require('../errors/AppError');
const { temCapacidade } = require('../services/permissoesService');

// Exige uma capacidade (Admin tem todas). Com mais de uma, basta ter UMA delas.
// Para rotas que não são só "de admin".
module.exports = (...capacidades) => (req, res, next) => {
    if (!capacidades.some((capacidade) => temCapacidade(req.usuario, capacidade))) {
        return next(new AppError('Acesso negado', 403));
    }

    return next();
};
