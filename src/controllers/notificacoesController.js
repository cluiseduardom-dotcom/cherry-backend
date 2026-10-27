const notificacoesService = require('../services/notificacoesService');
const response = require('../utils/response');

async function listar(req, res, next) {
    try {
        const dados = await notificacoesService.listar(req.usuario);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar };
