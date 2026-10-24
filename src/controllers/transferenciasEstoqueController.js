const service = require('../services/transferenciasEstoqueService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const {
    criarTransferenciaSchema, aceitarSchema, recusarOuCancelarSchema, criarLocalSchema, listarTransferenciasSchema
} = require('../validations/transferenciasEstoqueValidation');

function parseId(valor) {
    const id = Number(valor);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido', 400);
    return id;
}

function parseCorpo(schema, corpo) {
    const r = schema.safeParse(corpo ?? {});
    if (!r.success) throw new AppError(r.error.issues[0].message, 400);
    return r.data;
}

function paginacao(query) {
    let page = parseInt(query.page, 10);
    let pageSize = parseInt(query.pageSize, 10);
    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;
    return { page, pageSize };
}

const rota = (fn) => async (req, res, next) => {
    try {
        return await fn(req, res);
    } catch (error) {
        return next(error);
    }
};

const criar = rota(async (req, res) => {
    const dados = parseCorpo(criarTransferenciaSchema, req.body);
    return response.success(res, await service.criar(dados, req.usuario), 201);
});

const resolverCom = (acao, schema) => rota(async (req, res) => {
    const id = parseId(req.params.id);
    const { motivo } = parseCorpo(schema, req.body);
    return response.success(res, await service.resolver(acao, id, motivo, req.usuario));
});

const listar = rota(async (req, res) => {
    const filtros = parseCorpo(listarTransferenciasSchema, { status: req.query.status });
    return response.success(res, await service.listar({ ...filtros, ...paginacao(req.query) }, req.usuario));
});

const obter = rota(async (req, res) => response.success(res, await service.obter(parseId(req.params.id), req.usuario)));

const criarLocal = rota(async (req, res) => {
    const dados = parseCorpo(criarLocalSchema, req.body);
    return response.success(res, await service.criarLocal(dados, req.usuario), 201);
});

module.exports = {
    criar,
    listar,
    obter,
    criarLocal,
    aceitar: resolverCom('aceitar', aceitarSchema),
    recusar: resolverCom('recusar', recusarOuCancelarSchema),
    cancelar: resolverCom('cancelar', recusarOuCancelarSchema)
};
