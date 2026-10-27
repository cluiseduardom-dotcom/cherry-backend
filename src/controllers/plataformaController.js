const plataformaService = require('../services/plataformaService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { taxasPorEmpresaQuerySchema } = require('../validations/plataformaValidation');

async function taxasPorEmpresa(req, res, next) {
    try {
        const parsed = taxasPorEmpresaQuerySchema.safeParse(req.query);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        res.set('Cache-Control', 'no-store');

        return response.success(res, await plataformaService.taxasPorEmpresa(parsed.data.mes));
    } catch (error) {
        next(error);
    }
}

module.exports = { taxasPorEmpresa };
