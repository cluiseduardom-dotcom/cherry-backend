const service = require('../services/plataformaIdentidadeService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { empresaIdParamSchema, identidadeSchema } = require('../validations/plataformaValidation');

function validar(schema, dados) {
    const parsed = schema.safeParse(dados);

    if (!parsed.success) {
        throw new AppError(parsed.error.issues[0].message, 400);
    }

    return parsed.data;
}

// Quem fez a mudança: sempre o usuário autenticado (nunca o corpo da requisição).
const responsavelDe = (req) => `${req.usuario.email} (#${req.usuario.id})`;

async function listar(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, await service.listar());
    } catch (error) {
        next(error);
    }
}

async function historico(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        res.set('Cache-Control', 'no-store');
        return response.success(res, await service.historico(id));
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        const corpo = validar(identidadeSchema, req.body ?? {});

        const resultado = await service.atualizar({
            empresa_id: id,
            tema_visual: corpo.tema_visual,
            slug: corpo.slug,
            responsavel: responsavelDe(req)
        });

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, historico, atualizar };
