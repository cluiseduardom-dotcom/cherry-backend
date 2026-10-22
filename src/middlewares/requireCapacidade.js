const AppError = require('../errors/AppError');
const { temCapacidade } = require('../services/permissoesService');

// Exige uma capacidade (Admin tem todas). Para rotas que não são só "de admin".
module.exports = (capacidade) => (req, res, next) => {
    if (!temCapacidade(req.usuario, capacidade)) {
        return next(new AppError('Acesso negado', 403));
    }

    return next();
};
