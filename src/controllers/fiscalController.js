const AppError = require('../errors/AppError');
const response = require('../utils/response');
const service = require('../services/fiscalService');
const { empresaFiscalSchema, produtoFiscalSchema, loteSchema, listarProdutosFiscaisSchema } = require('../validations/fiscalValidation');

function parseId(valor) {
    const id = Number(valor);

    if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido', 400);

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

function validar(schema, entrada) {
    const parsed = schema.safeParse(entrada);

    if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);

    return parsed.data;
}

const acao = (executar) => async (req, res, next) => {
    try {
        return response.success(res, await executar(req));
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    obterEmpresa: acao((req) => service.obterEmpresa(req.usuario)),
    salvarEmpresa: acao((req) => service.salvarEmpresa(validar(empresaFiscalSchema, req.body), req.usuario)),
    listarProdutos: acao((req) => service.listarProdutos({ ...parsePaginacao(req.query), ...validar(listarProdutosFiscaisSchema, { filtro: req.query.filtro, q: req.query.q }) }, req.usuario)),
    atualizarProduto: acao((req) => service.atualizarProduto(parseId(req.params.id), validar(produtoFiscalSchema, req.body), req.usuario)),
    aplicarEmLote: acao((req) => service.aplicarEmLote(validar(loteSchema, req.body), req.usuario)),
    prontidao: acao((req) => service.prontidao(req.usuario))
};
