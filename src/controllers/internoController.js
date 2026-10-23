const internoService = require('../services/internoService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { empresaIdSchema, temaSchema, moduloSchema, codigoModuloSchema } = require('../validations/internoValidation');

function validar(schema, valor) {
    const parsed = schema.safeParse(valor);

    if (!parsed.success) {
        throw new AppError(parsed.error.issues[0].message, 400);
    }

    return parsed.data;
}

async function listarEmpresas(req, res, next) {
    try {
        return response.success(res, await internoService.listarEmpresas());
    } catch (error) {
        next(error);
    }
}

async function definirTema(req, res, next) {
    try {
        const empresa_id = validar(empresaIdSchema, req.params.id);
        const corpo = validar(temaSchema, req.body);

        return response.success(res, await internoService.definirTema({ empresa_id, ...corpo }));
    } catch (error) {
        next(error);
    }
}

async function definirModulo(req, res, next) {
    try {
        const empresa_id = validar(empresaIdSchema, req.params.id);
        const modulo = validar(codigoModuloSchema, req.params.modulo);
        const corpo = validar(moduloSchema, req.body);

        return response.success(res, await internoService.definirModulo({ empresa_id, modulo, ...corpo }));
    } catch (error) {
        next(error);
    }
}

module.exports = { listarEmpresas, definirTema, definirModulo };
