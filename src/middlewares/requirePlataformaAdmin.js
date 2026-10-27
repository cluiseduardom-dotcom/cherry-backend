const AppError = require('../errors/AppError');

// Exceção deliberada à regra "tudo filtrado por empresa_id": só o operador da plataforma
// (usuarios.plataforma_admin, lido do banco pelo authMiddleware) E com papel admin.
// Qualquer outro usuário — inclusive admin de empresa — recebe 403.
module.exports = (req, res, next) => {

    if (!req.usuario || req.usuario.plataforma_admin !== true || req.usuario.role !== 'admin') {
        return next(new AppError('Acesso restrito ao operador da plataforma', 403));
    }

    return next();

};
