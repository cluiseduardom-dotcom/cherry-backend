const cancelamentosService = require('../services/cancelamentosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { listarCancelamentosQuerySchema } = require('../validations/cancelamentosValidation');

async function listar(req, res, next) {
    try {
        const parsed = listarCancelamentosQuerySchema.safeParse(req.query);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        return response.success(res, await cancelamentosService.listar(parsed.data, req.usuario));
    } catch (error) {
        next(error);
    }
}

module.exports = { listar };
