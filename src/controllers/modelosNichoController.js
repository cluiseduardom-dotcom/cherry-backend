const db = require('../config/db');
const response = require('../utils/response');
const service = require('../services/modelosNichoService');

function listar(req, res, next) {
    try {
        return response.success(res, service.listar());
    } catch (error) {
        return next(error);
    }
}

// Transação própria: ou aplica o modelo inteiro ou nada. A empresa vem sempre do JWT.
async function aplicar(req, res, next) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const resultado = await service.aplicar(client, req.usuario.empresa_id, req.params.id);

        await client.query('COMMIT');

        return response.success(res, resultado);
    } catch (error) {
        await client.query('ROLLBACK');

        return next(error);
    } finally {
        client.release();
    }
}

module.exports = { listar, aplicar };
