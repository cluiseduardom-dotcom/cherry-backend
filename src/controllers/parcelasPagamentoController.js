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
        // Idempotency-Key opcional aqui (a rota é anterior à chave): se vier, precisa ser válida e é respeitada.
        const chave = (req.get('Idempotency-Key') ?? '').trim() || null;

        if (chave && !/^[A-Za-z0-9_-]{8,80}$/.test(chave)) {
            throw new AppError('Idempotency-Key inválida (8 a 80 letras, números, hífen ou sublinhado)', 400);
        }

        const resultado = await pagamentosService.receberParcela(
            id,
            { valor, forma_pagamento, observacao, chave },
            req.usuario
        );
        return response.success(res, resultado, 201);
    } catch (error) {
        next(error);
    }
}

module.exports = { receber };
