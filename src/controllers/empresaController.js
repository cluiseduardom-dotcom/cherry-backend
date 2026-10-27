const empresaService = require('../services/empresaService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { atualizarDadosEmpresaSchema } = require('../validations/empresaValidation');

async function obterDados(req, res, next) {
    try {
        return response.success(res, await empresaService.obterDados(req.usuario.empresa_id));
    } catch (error) {
        next(error);
    }
}

async function atualizarDados(req, res, next) {
    try {
        const parsed = atualizarDadosEmpresaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const resultado = await empresaService.atualizarDados(req.usuario.empresa_id, parsed.data, req.usuario.id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

module.exports = { obterDados, atualizarDados };
