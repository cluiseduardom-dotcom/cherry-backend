const usuarioFotosService = require('../services/usuarioFotosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { usuarioIdSchema } = require('../validations/usuariosValidation');

// Alvo: /usuarios/:id/foto (gestor) ou /auth/foto (a própria, sem :id). Sem :id é sempre o usuário do JWT.
function alvoDaRequisicao(req) {
    if (req.params.id === undefined) {
        return req.usuario.id;
    }

    const id = usuarioIdSchema.safeParse(req.params.id);

    if (!id.success) {
        throw new AppError(id.error.issues[0].message, 400);
    }

    return id.data;
}

async function definir(req, res, next) {
    try {
        const resultado = await usuarioFotosService.definir(alvoDaRequisicao(req), req.file, req.usuario);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function remover(req, res, next) {
    try {
        const resultado = await usuarioFotosService.remover(alvoDaRequisicao(req), req.usuario);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

module.exports = { definir, remover };
