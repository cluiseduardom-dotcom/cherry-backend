const AppError = require('../errors/AppError');
const response = require('../utils/response');
const service = require('../services/pedidosCompraFluxoService');
const { criarPedidoSchema, atualizarPedidoSchema, listarPedidosSchema } = require('../validations/pedidosCompraValidation');

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

const acao = (executar, status = 200) => async (req, res, next) => {
    try {
        return response.success(res, await executar(req), status);
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    criar: acao((req) => service.criar(validar(criarPedidoSchema, req.body), req.usuario), 201),
    listar: acao((req) => service.listar({ ...parsePaginacao(req.query), ...validar(listarPedidosSchema, { status: req.query.status, fornecedor_id: req.query.fornecedor_id }) }, req.usuario)),
    buscarPorId: acao((req) => service.obter(parseId(req.params.id), req.usuario)),
    atualizar: acao((req) => service.atualizar(parseId(req.params.id), validar(atualizarPedidoSchema, req.body), req.usuario)),
    enviar: acao((req) => service.enviar(parseId(req.params.id), req.usuario)),
    confirmar: acao((req) => service.confirmar(parseId(req.params.id), req.usuario)),
    cancelar: acao((req) => service.cancelar(parseId(req.params.id), req.usuario))
};
