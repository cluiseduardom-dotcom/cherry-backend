const taxasVendaService = require('../services/taxasVendaService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { listarTaxasVendaSchema } = require('../validations/taxasVendaValidation');

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
        const parsed = listarTaxasVendaSchema.safeParse({
            data_inicio: req.query.data_inicio,
            data_fim: req.query.data_fim
        });

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const resultado = await taxasVendaService.listar(
            { ...parsePaginacao(req.query), ...parsed.data },
            req.usuario.empresa_id
        );

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar };
