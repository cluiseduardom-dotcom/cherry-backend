const configuracoesSkuService = require('../services/configuracoesSkuService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { salvarConfiguracaoSkuSchema } = require('../validations/configuracoesSkuValidation');

async function listarTodos(req, res, next) {
    try {
        const configs = await configuracoesSkuService.listarTodos(req.usuario.empresa_id);
        return response.success(res, configs);
    } catch (error) {
        next(error);
    }
}

async function listar(req, res, next) {
    try {
        const config = await configuracoesSkuService.listar(req.usuario.empresa_id);
        return response.success(res, config);
    } catch (error) {
        next(error);
    }
}

async function salvar(req, res, next) {
    try {
        const parsed = salvarConfiguracaoSkuSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const config = await configuracoesSkuService.salvar(
            parsed.data,
            req.usuario.empresa_id
        );

        return response.success(res, config);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, listarTodos, salvar };
