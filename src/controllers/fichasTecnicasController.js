const fichasTecnicasService = require('../services/fichasTecnicasService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarFichaTecnicaSchema } = require('../validations/fichasTecnicasValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

// Espelha filtrarParaRole de produtosController: aqui quem perde visibilidade
// de custo é a estoquista (não a vendedor — vendedor já é barrada em 403 pelo
// requireEstoquista antes de chegar aqui).
function filtrarCustoParaRole(ficha, role) {
    if (role === 'admin') return ficha;

    const { custo_sugerido, itens, ...resto } = ficha;

    return {
        ...resto,
        itens: itens.map(({ custo_unitario, subtotal_custo, ...item }) => item)
    };
}

async function criar(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);

        const parsed = criarFichaTecnicaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const ficha = await fichasTecnicasService.criar(produtoId, parsed.data, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, filtrarCustoParaRole(ficha, req.usuario.role), 201);
    } catch (error) {
        next(error);
    }
}

async function buscarVigente(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const ficha = await fichasTecnicasService.buscarVigente(produtoId, req.usuario.empresa_id);

        return response.success(res, filtrarCustoParaRole(ficha, req.usuario.role));
    } catch (error) {
        next(error);
    }
}

async function historico(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const fichas = await fichasTecnicasService.historico(produtoId, req.usuario.empresa_id);

        return response.success(res, fichas);
    } catch (error) {
        next(error);
    }
}

module.exports = { criar, buscarVigente, historico };
