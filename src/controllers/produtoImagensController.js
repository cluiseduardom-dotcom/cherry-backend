const produtoImagensService = require('../services/produtoImagensService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');

function parseId(value, rotulo = 'ID') {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new AppError(`${rotulo} inválido`, 400);
    return id;
}

async function listar(req, res, next) {
    try {
        return response.success(res, await produtoImagensService.listar(parseId(req.params.id), req.usuario.empresa_id));
    } catch (error) { next(error); }
}

async function adicionar(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        return response.success(res, await produtoImagensService.adicionar(produtoId, req.file, req.usuario.empresa_id, req.usuario.id), 201);
    } catch (error) { next(error); }
}

async function remover(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const imagemId = parseId(req.params.imagemId, 'ID da foto');
        return response.success(res, await produtoImagensService.remover(produtoId, imagemId, req.usuario.empresa_id));
    } catch (error) { next(error); }
}

async function reordenar(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const ids = req.body && req.body.ids;

        if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
            throw new AppError('"ids" deve ser a lista de IDs das fotos na nova ordem', 400);
        }

        return response.success(res, await produtoImagensService.reordenar(produtoId, ids, req.usuario.empresa_id));
    } catch (error) { next(error); }
}

module.exports = { listar, adicionar, remover, reordenar };
