const vendasService = require('../services/vendasService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarVendaSchema } = require('../validations/vendasValidation');

async function resumo(req, res, next) {
    try {
        const dados = await vendasService.resumo();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function porDia(req, res, next) {
    try {
        const dados = await vendasService.porDia();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function porMes(req, res, next) {
    try {
        const dados = await vendasService.porMes();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function maisVendidos(req, res, next) {
    try {
        const dados = await vendasService.maisVendidos();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarVendaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const { cliente_id, itens } = parsed.data;

        const venda = await vendasService.criar(cliente_id, itens);

        return response.success(res, venda, 201);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    resumo,
    porDia,
    porMes,
    maisVendidos,
    criar
};
