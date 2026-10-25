const comissoesService = require('../services/comissoesService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const {
    periodoSchema,
    definirPercentualSchema,
    idSchema,
    repassesQuerySchema,
    confirmarRepasseSchema,
    registrarPagamentoComissaoSchema,
    pagamentosQuerySchema,
    definirModoPagamentoSchema
} = require('../validations/comissoesValidation');

function parsePaginacao(query) {
    let page = parseInt(query.page, 10);
    let pageSize = parseInt(query.pageSize, 10);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;

    return { page, pageSize };
}

function parsePeriodo(query) {
    const parsed = periodoSchema.safeParse({
        data_inicio: query.data_inicio,
        data_fim: query.data_fim
    });

    if (!parsed.success) {
        throw new AppError(parsed.error.issues[0].message, 400);
    }

    return parsed.data;
}

async function minhas(req, res, next) {
    try {
        const resultado = await comissoesService.minhas(
            { ...parsePaginacao(req.query), ...parsePeriodo(req.query) },
            req.usuario
        );

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function equipe(req, res, next) {
    try {
        const resultado = await comissoesService.equipe(parsePeriodo(req.query), req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function listarPercentuais(req, res, next) {
    try {
        const resultado = await comissoesService.listarPercentuais(req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function definirPercentual(req, res, next) {
    try {
        const parsed = definirPercentualSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const resultado = await comissoesService.definirPercentual(parsed.data, req.usuario);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

function parseId(valor) {
    const id = idSchema.safeParse(valor);

    if (!id.success) throw new AppError(id.error.issues[0].message, 400);

    return id.data;
}

async function repasses(req, res, next) {
    try {
        const query = repassesQuerySchema.safeParse({ status: req.query.status });

        if (!query.success) throw new AppError(query.error.issues[0].message, 400);

        const resultado = await comissoesService.repasses({ ...parsePaginacao(req.query), ...query.data }, req.usuario);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function confirmarRepasse(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const parsed = confirmarRepasseSchema.safeParse(req.body ?? {});

        if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);

        const resultado = await comissoesService.confirmarRepasse(id, parsed.data, req.usuario);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function historico(req, res, next) {
    try {
        const resultado = await comissoesService.historico(parseId(req.params.id), req.usuario);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function aPagar(req, res, next) {
    try {
        return response.success(res, await comissoesService.aPagar(req.usuario.empresa_id));
    } catch (error) {
        next(error);
    }
}

async function configuracao(req, res, next) {
    try {
        return response.success(res, await comissoesService.configuracao(req.usuario.empresa_id));
    } catch (error) {
        next(error);
    }
}

async function definirConfiguracao(req, res, next) {
    try {
        const parsed = definirModoPagamentoSchema.safeParse(req.body);

        if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);

        return response.success(res, await comissoesService.definirConfiguracao(parsed.data, req.usuario));
    } catch (error) {
        next(error);
    }
}

async function registrarPagamento(req, res, next) {
    try {
        const parsed = registrarPagamentoComissaoSchema.safeParse(req.body);

        if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);

        const resultado = await comissoesService.registrarPagamento(parsed.data, req.usuario);

        return response.success(res, resultado, 201);
    } catch (error) {
        next(error);
    }
}

async function pagamentos(req, res, next) {
    try {
        const query = pagamentosQuerySchema.safeParse({ vendedor_id: req.query.vendedor_id });

        if (!query.success) throw new AppError(query.error.issues[0].message, 400);

        const resultado = await comissoesService.pagamentos({ ...parsePaginacao(req.query), ...query.data }, req.usuario);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    minhas, equipe, listarPercentuais, definirPercentual, repasses, confirmarRepasse, historico,
    aPagar, registrarPagamento, pagamentos, configuracao, definirConfiguracao
};
