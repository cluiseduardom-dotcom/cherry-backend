const repository = require('../repositories/funcionalidadesPainelRepository');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const {
    empresaIdParamSchema,
    empresaFuncionalidadeParamSchema,
    definirFuncionalidadeSchema,
    removerFuncionalidadeSchema
} = require('../validations/plataformaValidation');

function validar(schema, dados) {
    const parsed = schema.safeParse(dados);

    if (!parsed.success) {
        throw new AppError(parsed.error.issues[0].message, 400);
    }

    return parsed.data;
}

// Quem fez a mudança: sempre o operador autenticado do painel (nunca o corpo da requisição).
const quem = (req) => ({ responsavel: req.responsavelPlataforma, operador_id: req.operador.id, ip: req.ip });

async function catalogo(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, await repository.catalogo());
    } catch (error) {
        next(error);
    }
}

async function listarDaEmpresa(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        res.set('Cache-Control', 'no-store');
        return response.success(res, await repository.listarDaEmpresa(id));
    } catch (error) {
        next(error);
    }
}

async function definir(req, res, next) {
    try {
        const { id, codigo } = validar(empresaFuncionalidadeParamSchema, req.params);
        const corpo = validar(definirFuncionalidadeSchema, req.body ?? {});

        return response.success(res, await repository.definirLigacao({ empresa_id: id, codigo, ...corpo, ...quem(req) }));
    } catch (error) {
        next(error);
    }
}

async function remover(req, res, next) {
    try {
        const { id, codigo } = validar(empresaFuncionalidadeParamSchema, req.params);
        const { justificativa } = validar(removerFuncionalidadeSchema, req.body ?? {});

        return response.success(res, await repository.removerLigacao({ empresa_id: id, codigo, justificativa, ...quem(req) }));
    } catch (error) {
        next(error);
    }
}

module.exports = { catalogo, listarDaEmpresa, definir, remover };
