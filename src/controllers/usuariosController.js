const usuariosService = require('../services/usuariosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarUsuarioSchema, bloqueioSchema, usuarioIdSchema } = require('../validations/usuariosValidation');

function parsePaginacao(query) {
    let page = parseInt(query.page, 10);
    let pageSize = parseInt(query.pageSize, 10);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;

    return { page, pageSize };
}

async function listar(req, res, next) {
    try {
        const resultado = await usuariosService.listar(req.usuario);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarUsuarioSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const resultado = await usuariosService.criar(parsed.data, req.usuario);

        return response.success(res, resultado, 201);
    } catch (error) {
        next(error);
    }
}

async function bloquear(req, res, next) {
    try {
        const id = usuarioIdSchema.safeParse(req.params.id);

        if (!id.success) {
            throw new AppError(id.error.issues[0].message, 400);
        }

        const parsed = bloqueioSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const resultado = await usuariosService.definirBloqueio(id.data, parsed.data, req.usuario);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function eventos(req, res, next) {
    try {
        const resultado = await usuariosService.listarEventos(parsePaginacao(req.query), req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, criar, bloquear, eventos };
