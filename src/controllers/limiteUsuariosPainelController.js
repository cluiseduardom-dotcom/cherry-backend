const repository = require('../repositories/limiteUsuariosPainelRepository');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { empresaIdParamSchema, definirLimiteUsuariosSchema, removerLimiteUsuariosSchema } = require('../validations/plataformaValidation');

function validar(schema, dados) {
    const parsed = schema.safeParse(dados);

    if (!parsed.success) {
        throw new AppError(parsed.error.issues[0].message, 400);
    }

    return parsed.data;
}

// Quem fez a mudança: sempre o operador autenticado do painel (nunca o corpo da requisição).
const quem = (req) => ({ responsavel: req.responsavelPlataforma, operador_id: req.operador.id, ip: req.ip });

async function obter(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        res.set('Cache-Control', 'no-store');
        return response.success(res, await repository.obter(id));
    } catch (error) {
        next(error);
    }
}

async function definir(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        const corpo = validar(definirLimiteUsuariosSchema, req.body ?? {});

        return response.success(res, await repository.definir({ empresa_id: id, ...corpo, ...quem(req) }));
    } catch (error) {
        next(error);
    }
}

async function remover(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        const { justificativa } = validar(removerLimiteUsuariosSchema, req.body ?? {});

        return response.success(res, await repository.remover({ empresa_id: id, justificativa, ...quem(req) }));
    } catch (error) {
        next(error);
    }
}

module.exports = { obter, definir, remover };
