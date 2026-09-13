const categoriasService = require('../services/categoriasService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarCategoriaSchema, atualizarCategoriaSchema } = require('../validations/categoriasValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

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
        const paginacao = parsePaginacao(req.query);
        const resultado = await categoriasService.listar(paginacao, req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarCategoriaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const categoria = await categoriasService.criar(parsed.data, req.usuario.empresa_id);

        return response.success(res, categoria, 201);
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const id = parseId(req.params.id);

        if ('codigo' in req.body || 'nivel' in req.body) {
            throw new AppError('Código e nível não podem ser alterados após a criação — crie uma nova categoria', 400);
        }

        const parsed = atualizarCategoriaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const categoria = await categoriasService.atualizar(id, parsed.data, req.usuario.empresa_id);

        return response.success(res, categoria);
    } catch (error) {
        next(error);
    }
}

async function remover(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const categoria = await categoriasService.remover(id, req.usuario.empresa_id);

        return response.success(res, categoria);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, criar, atualizar, remover };
