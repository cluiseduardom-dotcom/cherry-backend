const unidadesRepository = require('../repositories/unidadesRastreadasRepository');
const { normalizarIdentificador } = require('../utils/identificadorUnidade');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { listarUnidadesSchema } = require('../validations/unidadesValidation');

// Consulta de unidades rastreadas (IMEI/série). Qualquer usuário autenticado da empresa: o vendedor escolhe o aparelho na
// venda e o estoquista confere a entrada. A resposta nunca traz custo; o escopo é sempre o empresa_id do JWT.
async function listar(req, res, next) {
    try {
        const parsed = listarUnidadesSchema.safeParse(req.query);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const { page = 1, pageSize = 20, ...filtros } = parsed.data;
        const resultado = await unidadesRepository.listar({
            empresa_id: req.usuario.empresa_id,
            ...filtros,
            limit: pageSize,
            offset: (page - 1) * pageSize
        });

        return response.success(res, { ...resultado, page, pageSize });
    } catch (error) {
        next(error);
    }
}

async function buscarPorIdentificador(req, res, next) {
    try {
        const identificador = normalizarIdentificador(req.params.identificador);

        if (!identificador || identificador.length > 40) {
            throw new AppError('IMEI/série inválido', 400);
        }

        const unidade = await unidadesRepository.buscarComHistorico({ empresa_id: req.usuario.empresa_id, identificador });

        if (!unidade) {
            throw new AppError('IMEI/série não encontrado', 404);
        }

        return response.success(res, unidade);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, buscarPorIdentificador };
