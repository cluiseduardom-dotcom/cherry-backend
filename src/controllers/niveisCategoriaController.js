const niveisCategoriaService = require('../services/niveisCategoriaService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarNivelCategoriaSchema, atualizarNivelCategoriaSchema } = require('../validations/niveisCategoriaValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

async function listar(req, res, next) {
    try {
        const niveis = await niveisCategoriaService.listar(req.usuario.empresa_id);
        return response.success(res, niveis);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarNivelCategoriaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const nivel = await niveisCategoriaService.criar(parsed.data, req.usuario.empresa_id);

        return response.success(res, nivel, 201);
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const id = parseId(req.params.id);

        if ('nivel' in req.body) {
            throw new AppError('O nível não pode ser alterado após a criação — remova este rótulo e crie um novo', 400);
        }

        const parsed = atualizarNivelCategoriaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const nivel = await niveisCategoriaService.atualizar(id, parsed.data, req.usuario.empresa_id);

        return response.success(res, nivel);
    } catch (error) {
        next(error);
    }
}

async function remover(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const nivel = await niveisCategoriaService.remover(id, req.usuario.empresa_id);

        return response.success(res, nivel);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, criar, atualizar, remover };
