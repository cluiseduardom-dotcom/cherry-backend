const pagamentosService = require('../services/pagamentosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');

function parseId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido', 400);
    return id;
}

async function receber(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const { valor, forma_pagamento, observacao } = req.body || {};
        const resultado = await pagamentosService.receberParcela(
            id,
            { valor, forma_pagamento, observacao },
            req.usuario
        );
        return response.success(res, resultado, 201);
    } catch (error) {
        next(error);
    }
}

module.exports = { receber };
