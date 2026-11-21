const AppError = require('../errors/AppError');
const response = require('../utils/response');
const service = require('../services/gradesService');
const { criarGradeSchema, acrescentarVariacoesSchema, atualizarGradeSchema } = require('../validations/gradesValidation');

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
    criar: acao((req) => service.criar(validar(criarGradeSchema, req.body), req.usuario), 201),
    listar: acao((req) => service.listar(parsePaginacao(req.query), req.usuario)),
    buscarPorId: acao((req) => service.buscarPorId(parseId(req.params.id), req.usuario)),
    acrescentar: acao((req) => service.acrescentar(parseId(req.params.id), validar(acrescentarVariacoesSchema, req.body), req.usuario), 201),
    atualizar: acao((req) => service.atualizar(parseId(req.params.id), validar(atualizarGradeSchema, req.body), req.usuario))
};
