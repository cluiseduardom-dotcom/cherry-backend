const despesasFixasService = require('../services/despesasFixasService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarDespesaFixaSchema, atualizarDespesaFixaSchema } = require('../validations/despesasFixasValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

async function listar(req, res, next) {
    try {
        const despesas = await despesasFixasService.listar(req.usuario.empresa_id);

        return response.success(res, despesas);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarDespesaFixaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const despesa = await despesasFixasService.criar(parsed.data, req.usuario.empresa_id);

        return response.success(res, despesa, 201);
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const id = parseId(req.params.id);

        const parsed = atualizarDespesaFixaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const despesa = await despesasFixasService.atualizar(id, parsed.data, req.usuario.empresa_id);

        return response.success(res, despesa);
    } catch (error) {
        next(error);
    }
}

async function remover(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const despesa = await despesasFixasService.remover(id, req.usuario.empresa_id);

        return response.success(res, despesa);
    } catch (error) {
        next(error);
    }
}

async function alternarAtivo(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const despesa = await despesasFixasService.alternarAtivo(id, req.usuario.empresa_id);

        return response.success(res, despesa);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    listar,
    criar,
    atualizar,
    remover,
    alternarAtivo
};
