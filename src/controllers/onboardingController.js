const onboardingService = require('../services/onboardingService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { onboardingSchema } = require('../validations/onboardingValidation');

async function criarTenant(req, res, next) {
    try {
        const parsed = onboardingSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const resultado = await onboardingService.criarTenant(parsed.data);

        return response.success(res, resultado, 201);
    } catch (error) {
        next(error);
    }
}

module.exports = { criarTenant };
