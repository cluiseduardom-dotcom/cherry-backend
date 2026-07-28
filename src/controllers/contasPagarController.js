const contasPagarService = require('../services/contasPagarService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const {
    criarContaPagarSchema,
    atualizarContaPagarSchema,
    listarContasPagarSchema
} = require('../validations/contasPagarValidation');

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

        const parsedFiltros = listarContasPagarSchema.safeParse({
            status: req.query.status,
            vencimento_de: req.query.vencimento_de,
            vencimento_ate: req.query.vencimento_ate
        });

        if (!parsedFiltros.success) {
            throw new AppError(parsedFiltros.error.issues[0].message, 400);
        }

        const resultado = await contasPagarService.listar({
            ...paginacao,
            status: parsedFiltros.data.status,
            vencimentoDe: parsedFiltros.data.vencimento_de,
            vencimentoAte: parsedFiltros.data.vencimento_ate
        });

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function buscarPorId(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const conta = await contasPagarService.buscarPorId(id);

        return response.success(res, conta);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarContaPagarSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const conta = await contasPagarService.criar(parsed.data, req.usuario.id);

        return response.success(res, conta, 201);
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const id = parseId(req.params.id);

        const parsed = atualizarContaPagarSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const conta = await contasPagarService.atualizar(id, parsed.data);

        return response.success(res, conta);
    } catch (error) {
        next(error);
    }
}

async function marcarComoPaga(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const conta = await contasPagarService.marcarComoPaga(id);

        return response.success(res, conta);
    } catch (error) {
        next(error);
    }
}

async function cancelar(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const conta = await contasPagarService.cancelar(id);

        return response.success(res, conta);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    listar,
    buscarPorId,
    criar,
    atualizar,
    marcarComoPaga,
    cancelar
};
