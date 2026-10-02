const produtosCodigosService = require('../services/produtosCodigosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');

function parseId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido', 400);
    return id;
}

async function listar(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        return response.success(res, await produtosCodigosService.listarPorProduto(produtoId, req.usuario.empresa_id));
    } catch (error) { next(error); }
}

async function buscar(req, res, next) {
    try {
        return response.success(res, await produtosCodigosService.buscarPorCodigo(req.params.codigo, req.usuario.empresa_id));
    } catch (error) { next(error); }
}

async function adicionar(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        if (!req.body || typeof req.body.codigo !== 'string') throw new AppError('Código é obrigatório', 400);
        return response.success(res, await produtosCodigosService.adicionar(produtoId, req.body, req.usuario.empresa_id, req.usuario.id), 201);
    } catch (error) { next(error); }
}

async function remover(req, res, next) {
    try {
        const id = parseId(req.params.codigoId);
        return response.success(res, await produtosCodigosService.remover(id, req.usuario.empresa_id));
    } catch (error) { next(error); }
}

module.exports = { listar, buscar, adicionar, remover };
