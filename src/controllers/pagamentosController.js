const pagamentosService = require('../services/pagamentosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');

function parseId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido', 400);
    return id;
}

async function buscar(req, res, next) {
    try {
        const pagamento = await pagamentosService.buscarPagamento(parseId(req.params.id), req.usuario);
        return response.success(res, pagamento);
    } catch (error) {
        next(error);
    }
}

async function estornar(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const { valor, motivo } = req.body || {};
        const estorno = await pagamentosService.estornarPagamento(id, { valor, motivo }, req.usuario);
        return response.success(res, estorno, 201);
    } catch (error) {
        next(error);
    }
}

module.exports = { buscar, estornar };
