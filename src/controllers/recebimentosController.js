const AppError = require('../errors/AppError');
const recebimentosService = require('../services/recebimentosService');
const integracaoService = require('../services/integracaoRecebimentoService');

function id(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new AppError('ID inválido', 400);
    return n;
}

async function criar(req, res, next) {
    try {
        const resultado = await recebimentosService.criar({
            ...req.body,
            empresa_id: req.usuario.empresa_id,
            usuario_id: req.usuario.id
        });
        return res.status(201).json(resultado);
    } catch (error) { next(error); }
}

async function adicionarItem(req, res, next) {
    try {
        const resultado = await recebimentosService.adicionarItem(
            id(req.params.id),
            req.body,
            req.usuario
        );
        return res.status(201).json(resultado);
    } catch (error) { next(error); }
}

async function alterarStatus(req, res, next) {
    try {
        const resultado = await recebimentosService.alterarStatus(
            id(req.params.id),
            req.body.status,
            req.usuario
        );
        return res.json(resultado);
    } catch (error) { next(error); }
}

async function aprovar(req, res, next) {
    try {
        const resultado = await integracaoService.aprovar(id(req.params.id), req.usuario);
        return res.json(resultado);
    } catch (error) { next(error); }
}

async function obter(req, res, next) {
    try {
        return res.json(await recebimentosService.obter(id(req.params.id), req.usuario));
    } catch (error) { next(error); }
}

async function listar(req, res, next) {
    try {
        return res.json(await recebimentosService.listar(req.query, req.usuario));
    } catch (error) { next(error); }
}

module.exports = { criar, adicionarItem, alterarStatus, aprovar, obter, listar };
