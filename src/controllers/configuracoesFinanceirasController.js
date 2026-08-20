const configuracoesFinanceirasService = require('../services/configuracoesFinanceirasService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { atualizarConfiguracaoFinanceiraSchema } = require('../validations/configuracoesFinanceirasValidation');

async function obter(req, res, next) {
    try {
        const configuracao = await configuracoesFinanceirasService.obter(req.usuario.empresa_id);

        return response.success(res, configuracao);
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const parsed = atualizarConfiguracaoFinanceiraSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const configuracao = await configuracoesFinanceirasService.atualizar(
            req.usuario.empresa_id,
            parsed.data.aliquota_imposto
        );

        return response.success(res, configuracao);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    obter,
    atualizar
};
