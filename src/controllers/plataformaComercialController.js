const plataformaComercialService = require('../services/plataformaComercialService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const {
    empresaIdParamSchema,
    trocarPlanoSchema,
    definirCondicaoSchema,
    encerrarCondicaoSchema
} = require('../validations/plataformaValidation');

function validar(schema, dados) {
    const parsed = schema.safeParse(dados);

    if (!parsed.success) {
        throw new AppError(parsed.error.issues[0].message, 400);
    }

    return parsed.data;
}

// Quem fez a mudança: sempre o usuário autenticado (nunca o corpo da requisição).
const responsavelDe = (req) => `${req.usuario.email} (#${req.usuario.id})`;

async function listarPlanos(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, await plataformaComercialService.listarPlanos());
    } catch (error) {
        next(error);
    }
}

async function listarEmpresas(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, await plataformaComercialService.listarEmpresas());
    } catch (error) {
        next(error);
    }
}

async function historico(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        res.set('Cache-Control', 'no-store');
        return response.success(res, await plataformaComercialService.historico(id));
    } catch (error) {
        next(error);
    }
}

async function trocarPlano(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        const corpo = validar(trocarPlanoSchema, req.body ?? {});

        const resultado = await plataformaComercialService.trocarPlano({
            empresa_id: id,
            plano_codigo: corpo.plano,
            vigencia_inicio: corpo.vigencia_inicio,
            justificativa: corpo.justificativa,
            responsavel: responsavelDe(req)
        });

        return response.success(res, resultado, 201);
    } catch (error) {
        next(error);
    }
}

async function definirCondicao(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        const corpo = validar(definirCondicaoSchema, req.body ?? {});

        const resultado = await plataformaComercialService.definirCondicao({
            empresa_id: id,
            percentual: corpo.percentual,
            vigencia_inicio: corpo.vigencia_inicio,
            vigencia_fim: corpo.vigencia_fim,
            justificativa: corpo.justificativa,
            responsavel: responsavelDe(req)
        });

        return response.success(res, resultado, 201);
    } catch (error) {
        next(error);
    }
}

async function encerrarCondicao(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        const corpo = validar(encerrarCondicaoSchema, req.body ?? {});

        const resultado = await plataformaComercialService.encerrarCondicao({
            empresa_id: id,
            a_partir_de: corpo.a_partir_de,
            justificativa: corpo.justificativa,
            responsavel: responsavelDe(req)
        });

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

module.exports = { listarPlanos, listarEmpresas, historico, trocarPlano, definirCondicao, encerrarCondicao };
