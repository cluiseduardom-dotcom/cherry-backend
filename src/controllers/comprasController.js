const comprasService = require('../services/comprasService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarCompraSchema, listarComprasSchema } = require('../validations/comprasValidation');

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

async function criar(req, res, next) {
    try {
        const parsed = criarCompraSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const compra = await comprasService.criar(parsed.data, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, compra, 201);
    } catch (error) {
        next(error);
    }
}

async function listar(req, res, next) {
    try {
        const paginacao = parsePaginacao(req.query);

        const parsedFiltros = listarComprasSchema.safeParse({
            fornecedor_id: req.query.fornecedor_id,
            data_de: req.query.data_de,
            data_ate: req.query.data_ate
        });

        if (!parsedFiltros.success) {
            throw new AppError(parsedFiltros.error.issues[0].message, 400);
        }

        const resultado = await comprasService.listar({
            ...paginacao,
            fornecedor_id: parsedFiltros.data.fornecedor_id,
            dataDe: parsedFiltros.data.data_de,
            dataAte: parsedFiltros.data.data_ate
        }, req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function buscarPorId(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const compra = await comprasService.buscarPorId(id, req.usuario.empresa_id);

        return response.success(res, compra);
    } catch (error) {
        next(error);
    }
}

async function cancelar(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const compra = await comprasService.cancelar(id, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, compra);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    criar,
    listar,
    buscarPorId,
    cancelar
};
