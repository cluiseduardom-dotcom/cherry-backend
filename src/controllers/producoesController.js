const producoesService = require('../services/producoesService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarProducaoSchema, listarProducoesSchema } = require('../validations/producoesValidation');

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

// A estoquista nunca vê o custo total consumido nem o custo unitário de cada
// insumo — mesmo filtro de fichasTecnicasController.filtrarCustoParaRole.
function filtrarCustoParaRole(producao, role) {
    if (role === 'admin') return producao;

    const { custo_total, itens, ...resto } = producao;

    return {
        ...resto,
        ...(itens && { itens: itens.map(({ custo_unitario, subtotal_custo, ...item }) => item) })
    };
}

async function criar(req, res, next) {
    try {
        const parsed = criarProducaoSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const producao = await producoesService.criar(parsed.data, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, producao, 201);
    } catch (error) {
        next(error);
    }
}

async function listar(req, res, next) {
    try {
        const paginacao = parsePaginacao(req.query);

        const parsedFiltros = listarProducoesSchema.safeParse({
            produto_id: req.query.produto_id,
            data_de: req.query.data_de,
            data_ate: req.query.data_ate
        });

        if (!parsedFiltros.success) {
            throw new AppError(parsedFiltros.error.issues[0].message, 400);
        }

        const resultado = await producoesService.listar({
            ...paginacao,
            produto_id: parsedFiltros.data.produto_id,
            dataDe: parsedFiltros.data.data_de,
            dataAte: parsedFiltros.data.data_ate
        }, req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function buscarPorId(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const producao = await producoesService.buscarPorId(id, req.usuario.empresa_id);

        return response.success(res, filtrarCustoParaRole(producao, req.usuario.role));
    } catch (error) {
        next(error);
    }
}

async function cancelar(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const producao = await producoesService.cancelar(id, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, producao);
    } catch (error) {
        next(error);
    }
}

module.exports = { criar, listar, buscarPorId, cancelar };
