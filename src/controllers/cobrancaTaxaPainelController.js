const repository = require('../repositories/cobrancaTaxaRepository');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { hojeSP } = require('../utils/dataSaoPaulo');
const {
    cobrancaTaxaQuerySchema,
    periodoIdParamSchema,
    empresaIdParamSchema,
    fecharPeriodoSchema,
    pagamentoTaxaSchema,
    perdaoTaxaSchema,
    ajusteTaxaSchema
} = require('../validations/plataformaValidation');

// Taxas a receber (Painel GiroNex): fechamento do período e lançamentos. Só operador do painel (requirePainel
// na rota). Responsável e operador vêm SEMPRE da sessão, nunca do corpo; a trilha é gravada pelo repository.

function validar(schema, dados) {
    const parsed = schema.safeParse(dados);

    if (!parsed.success) {
        throw new AppError(parsed.error.issues[0].message, 400);
    }

    return parsed.data;
}

const quem = (req) => ({ responsavel: req.responsavelPlataforma, operador_id: req.operador.id, ip: req.ip });

async function resumo(req, res, next) {
    try {
        const filtros = validar(cobrancaTaxaQuerySchema, req.query);
        res.set('Cache-Control', 'no-store');
        return response.success(res, await repository.resumoCompetencia(filtros));
    } catch (error) {
        next(error);
    }
}

async function detalhe(req, res, next) {
    try {
        const { id } = validar(periodoIdParamSchema, req.params);
        res.set('Cache-Control', 'no-store');
        return response.success(res, await repository.detalhePeriodo(id));
    } catch (error) {
        next(error);
    }
}

async function fechar(req, res, next) {
    try {
        const corpo = validar(fecharPeriodoSchema, req.body ?? {});
        return response.success(res, await repository.fecharCompetencia({ ...corpo, ...quem(req) }));
    } catch (error) {
        next(error);
    }
}

async function pagamento(req, res, next) {
    try {
        const { id } = validar(periodoIdParamSchema, req.params);
        const corpo = validar(pagamentoTaxaSchema, req.body ?? {});

        if (corpo.data_pagamento > hojeSP()) {
            throw new AppError('A data do pagamento não pode ser futura.', 400);
        }

        return response.success(res, await repository.lancarEmPeriodoFechado({
            periodo_id: id, tipo: 'pagamento', ...corpo, ...quem(req)
        }), 201);
    } catch (error) {
        next(error);
    }
}

async function perdao(req, res, next) {
    try {
        const { id } = validar(periodoIdParamSchema, req.params);
        const corpo = validar(perdaoTaxaSchema, req.body ?? {});

        return response.success(res, await repository.lancarEmPeriodoFechado({
            periodo_id: id, tipo: 'perdao', ...corpo, ...quem(req)
        }), 201);
    } catch (error) {
        next(error);
    }
}

async function ajuste(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        const corpo = validar(ajusteTaxaSchema, req.body ?? {});

        return response.success(res, await repository.lancarAjuste({ empresa_id: id, ...corpo, ...quem(req) }), 201);
    } catch (error) {
        next(error);
    }
}

module.exports = { resumo, detalhe, fechar, pagamento, perdao, ajuste };
