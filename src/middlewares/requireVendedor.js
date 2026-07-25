const AppError = require('../errors/AppError');

const PAPEIS_PERMITIDOS = ['admin', 'vendedor'];

module.exports = (req, res, next) => {

    if (!req.usuario || !PAPEIS_PERMITIDOS.includes(req.usuario.role)) {
        return next(new AppError('Acesso restrito a administradores e vendedores', 403));
    }

    return next();

};
