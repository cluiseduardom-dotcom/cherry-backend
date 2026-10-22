const cargosService = require('../services/cargosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { cargoSchema, atualizarCargoSchema } = require('../validations/cargosValidation');

async function listar(req, res, next) {
    try {
        return response.success(res, await cargosService.listar(req.usuario.empresa_id));
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const cargo = cargoSchema.safeParse(req.params.cargo);

        if (!cargo.success) {
            throw new AppError(cargo.error.issues[0].message, 400);
        }

        const dados = atualizarCargoSchema.safeParse(req.body);

        if (!dados.success) {
            throw new AppError(dados.error.issues[0].message, 400);
        }

        const atualizado = await cargosService.atualizar(req.usuario.empresa_id, cargo.data, dados.data, req.usuario.id);

        return response.success(res, atualizado);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, atualizar };
