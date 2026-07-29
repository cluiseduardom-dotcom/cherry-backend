const precosService = require('../services/precosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { definirPrecoSchema } = require('../validations/precosValidation');

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

function filtrarPrecoParaRole(preco, role) {
    if (role !== 'vendedor') return preco;

    return { canal: preco.canal, preco_venda: preco.preco_venda };
}

async function listarCanais(req, res, next) {
    try {
        const canais = await precosService.listarCanais(req.usuario.empresa_id);
        return response.success(res, canais);
    } catch (error) {
        next(error);
    }
}

async function listarVigentes(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const precos = await precosService.listarVigentesPorProduto(produtoId, req.usuario.empresa_id);

        const filtrados = precos.map((preco) => filtrarPrecoParaRole(preco, req.usuario.role));

        return response.success(res, filtrados);
    } catch (error) {
        next(error);
    }
}

async function historico(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const paginacao = parsePaginacao(req.query);

        const resultado = await precosService.historicoPorProduto(produtoId, req.query.canal, paginacao, req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function definirPreco(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const canalId = parseId(req.params.canalId);

        const parsed = definirPrecoSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const preco = await precosService.definirPreco(produtoId, canalId, parsed.data, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, preco, 201);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    listarCanais,
    listarVigentes,
    historico,
    definirPreco
};
