const vendasService = require('../services/vendasService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarVendaSchema } = require('../validations/vendasValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

function parsePaginacao(query) {
    let page = parseInt(query.page, 10);
    let pageSize = parseInt(query.pageSize, 10);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;

    return { page, pageSize };
}

// custo_unitario é dado de custo — vendedor nunca vê, mesmo padrão de
// produtosController.filtrarParaRole. venda.itens pode não existir
// (listagem paginada hoje não inclui itens), por isso o guard.
function filtrarParaRole(venda, role) {
    if (role !== 'vendedor' || !Array.isArray(venda.itens)) return venda;

    return {
        ...venda,
        itens: venda.itens.map(({ custo_unitario, ...resto }) => resto)
    };
}

async function resumo(req, res, next) {
    try {
        const dados = await vendasService.resumo(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function porDia(req, res, next) {
    try {
        const dados = await vendasService.porDia(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function porMes(req, res, next) {
    try {
        const dados = await vendasService.porMes(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function maisVendidos(req, res, next) {
    try {
        const dados = await vendasService.maisVendidos(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarVendaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const venda = await vendasService.criar(parsed.data, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, filtrarParaRole(venda, req.usuario.role), 201);
    } catch (error) {
        next(error);
    }
}

async function listar(req, res, next) {
    try {
        const paginacao = parsePaginacao(req.query);
        const resultado = await vendasService.listar(paginacao, req.usuario);
        const items = resultado.items.map((venda) => filtrarParaRole(venda, req.usuario.role));

        return response.success(res, { ...resultado, items });
    } catch (error) {
        next(error);
    }
}

async function buscarPorId(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const venda = await vendasService.buscarPorId(id, req.usuario);

        return response.success(res, filtrarParaRole(venda, req.usuario.role));
    } catch (error) {
        next(error);
    }
}

async function cancelar(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const venda = await vendasService.cancelar(id, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, venda);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    resumo,
    porDia,
    porMes,
    maisVendidos,
    criar,
    listar,
    buscarPorId,
    cancelar
};
