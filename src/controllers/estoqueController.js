const estoqueService = require('../services/estoqueService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { registrarMovimentacaoSchema } = require('../validations/estoqueValidation');

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

async function registrarMovimentacao(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);

        const parsed = registrarMovimentacaoSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const movimentacao = await estoqueService.registrarMovimentacao(
            produtoId,
            parsed.data,
            req.usuario.id
        );

        return response.success(res, movimentacao, 201);
    } catch (error) {
        next(error);
    }
}

async function historico(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const paginacao = parsePaginacao(req.query);

        const resultado = await estoqueService.historicoPorProduto(produtoId, paginacao);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function alertas(req, res, next) {
    try {
        const dados = await estoqueService.alertasEstoqueBaixo();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    registrarMovimentacao,
    historico,
    alertas
};
