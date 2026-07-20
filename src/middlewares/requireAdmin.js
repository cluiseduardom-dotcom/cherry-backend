const AppError = require('../errors/AppError');

module.exports = (req, res, next) => {

    if (!req.usuario || req.usuario.role !== 'admin') {
        return next(new AppError('Acesso restrito a administradores', 403));
    }

    return next();

};
