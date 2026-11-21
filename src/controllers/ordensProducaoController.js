const AppError = require('../errors/AppError');
const response = require('../utils/response');
const service = require('../services/ordensProducaoService');
const { criarOrdemSchema, listarOrdensSchema, concluirOrdemSchema, cancelarOrdemSchema } = require('../validations/ordensProducaoValidation');

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

// Cada ação: valida a entrada, chama o serviço e responde; erro vai para o handler global.
const acao = (executar, status = 200) => async (req, res, next) => {
    try {
        return response.success(res, await executar(req), status);
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    criar: acao((req) => service.criar(validar(criarOrdemSchema, req.body), req.usuario), 201),
    listar: acao((req) => service.listar(
        { ...parsePaginacao(req.query), ...validar(listarOrdensSchema, { status: req.query.status, produto_id: req.query.produto_id }) },
        req.usuario
    )),
    buscarPorId: acao((req) => service.buscarPorId(parseId(req.params.id), req.usuario)),
    iniciar: acao((req) => service.iniciar(parseId(req.params.id), req.usuario)),
    concluir: acao((req) => service.concluir(parseId(req.params.id), validar(concluirOrdemSchema, req.body ?? {}), req.usuario)),
    regularizarInsumos: acao((req) => service.regularizarInsumos(parseId(req.params.id), req.usuario)),
    cancelar: acao((req) => service.cancelar(parseId(req.params.id), validar(cancelarOrdemSchema, req.body ?? {}), req.usuario))
};
