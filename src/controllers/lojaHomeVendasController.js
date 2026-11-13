const repository = require('../repositories/lojaHomeVendasRepository');
const AppError = require('../errors/AppError');
const response = require('../utils/response');
const { homeVendasSchema } = require('../validations/lojaValidation');

// Gestão (admin + loja_online; ver app.js). Nunca em cache: o admin precisa ver o estado atual.
async function buscar(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, await repository.buscar(req.usuario.empresa_id));
    } catch (error) { next(error); }
}

async function salvar(req, res, next) {
    try {
        const corpo = homeVendasSchema.safeParse(req.body ?? {});

        if (!corpo.success) throw new AppError(corpo.error.issues[0].message, 400);

        return response.success(res, await repository.salvar(req.usuario.empresa_id, corpo.data));
    } catch (error) { next(error); }
}

module.exports = { buscar, salvar };
