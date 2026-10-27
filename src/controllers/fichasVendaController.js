const fichasVendaService = require('../services/fichasVendaService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarFichaVendaSchema } = require('../validations/fichasVendaValidation');
const { podeVerCustos } = require('../services/permissoesService');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

// Quem não vê custo (ex.: estoquista sem a capacidade) recebe a composição, sem nenhum valor.
function removerCustos(ficha) {
    const { custo_item, custo_insumos, custo_total_sku, itens, ...resto } = ficha;

    return {
        ...resto,
        itens: itens.map(({ custo_unitario, subtotal_custo, ...item }) => item)
    };
}

function filtrarCustoParaRole(ficha, usuario) {
    return podeVerCustos(usuario) ? ficha : removerCustos(ficha);
}

async function criar(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const parsed = criarFichaVendaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const ficha = await fichasVendaService.criar(produtoId, parsed.data, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, filtrarCustoParaRole(ficha, req.usuario), 201);
    } catch (error) {
        next(error);
    }
}

async function buscarVigente(req, res, next) {
    try {
        const ficha = await fichasVendaService.buscarVigente(parseId(req.params.id), req.usuario.empresa_id);

        return response.success(res, filtrarCustoParaRole(ficha, req.usuario));
    } catch (error) {
        next(error);
    }
}

async function historico(req, res, next) {
    try {
        const fichas = await fichasVendaService.historico(parseId(req.params.id), req.usuario.empresa_id);

        return response.success(res, fichas.map((ficha) => filtrarCustoParaRole(ficha, req.usuario)));
    } catch (error) {
        next(error);
    }
}

module.exports = { criar, buscarVigente, historico };
