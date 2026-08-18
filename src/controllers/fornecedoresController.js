const fornecedoresService = require('../services/fornecedoresService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarFornecedorSchema, atualizarFornecedorSchema } = require('../validations/fornecedoresValidation');

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

function parseNome(query) {
    return typeof query.nome === 'string' && query.nome.trim() !== '' ? query.nome.trim() : undefined;
}

async function listar(req, res, next) {
    try {
        const paginacao = parsePaginacao(req.query);
        const nome = parseNome(req.query);

        const resultado = await fornecedoresService.listar({ ...paginacao, nome }, req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function buscarPorId(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const fornecedor = await fornecedoresService.buscarPorId(id, req.usuario.empresa_id);

        return response.success(res, fornecedor);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarFornecedorSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const fornecedor = await fornecedoresService.criar(parsed.data, req.usuario.empresa_id);

        return response.success(res, fornecedor, 201);
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const id = parseId(req.params.id);

        const parsed = atualizarFornecedorSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const fornecedor = await fornecedoresService.atualizar(id, parsed.data, req.usuario.empresa_id);

        return response.success(res, fornecedor);
    } catch (error) {
        next(error);
    }
}

async function remover(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const fornecedor = await fornecedoresService.remover(id, req.usuario.empresa_id);

        return response.success(res, fornecedor);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    listar,
    buscarPorId,
    criar,
    atualizar,
    remover
};
