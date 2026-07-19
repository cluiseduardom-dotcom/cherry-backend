const jwt = require('jsonwebtoken');
const AppError = require('../errors/AppError');

module.exports = (req, res, next) => {

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new AppError('Token não informado', 401));
    }

    const token = authHeader.split(' ')[1];

    try {

        const payload = jwt.verify(token, process.env.JWT_SECRET);

        req.usuario = { id: payload.id, role: payload.role };

        return next();

    } catch (error) {

        return next(new AppError('Token inválido ou expirado', 401));

    }

};
