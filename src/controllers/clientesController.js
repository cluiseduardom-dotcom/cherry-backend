const clientesService = require('../services/clientesService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarClienteSchema } = require('../validations/clientesValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

async function listar(req, res, next) {
    try {
        const clientes = await clientesService.listar();
        return response.success(res, clientes);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarClienteSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const cliente = await clientesService.criar(parsed.data);

        return response.success(res, cliente, 201);
    } catch (error) {
        next(error);
    }
}

async function historico(req, res, next) {
    try {
        const id = parseId(req.params.id);

        const registros = await clientesService.historico(id);

        return response.success(res, registros);
    } catch (error) {
        next(error);
    }
}

async function ranking(req, res, next) {
    try {
        const dados = await clientesService.ranking();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function totalGasto(req, res, next) {
    try {
        const id = parseId(req.params.id);

        const dados = await clientesService.totalGasto(id);

        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    listar,
    criar,
    historico,
    ranking,
    totalGasto
};
