const importacaoListaService = require('../services/importacaoListaService');
const confirmacaoService = require('../services/importacaoListaConfirmacaoService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { previaSchema, modeloSchema, confirmarSchema, idImportacaoSchema } = require('../validations/importacaoListaValidation');

function modelo(req, res, next) {
    try {
        const parsed = modeloSchema.safeParse(req.query);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const { nome, conteudo } = importacaoListaService.gerarModelo(parsed.data.tipo, parsed.data.formato);

        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="${nome}"`);
        res.set('Cache-Control', 'no-store');
        return res.status(200).send(conteudo);
    } catch (error) {
        next(error);
    }
}

async function previa(req, res, next) {
    try {
        const parsed = previaSchema.safeParse(req.body ?? {});

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const resultado = await importacaoListaService.previa(
            { tipo: parsed.data.tipo, localPadraoId: parsed.data.local_padrao_id, arquivo: req.file },
            req.usuario
        );

        res.set('Cache-Control', 'no-store');
        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function confirmar(req, res, next) {
    try {
        const parsed = confirmarSchema.safeParse(req.body ?? {});

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const resultado = await confirmacaoService.confirmar(
            { token: parsed.data.token, somenteValidas: parsed.data.somente_validas },
            req.usuario
        );

        res.set('Cache-Control', 'no-store');
        return response.success(res, resultado, 201);
    } catch (error) {
        next(error);
    }
}

async function relatorio(req, res, next) {
    try {
        const id = idImportacaoSchema.safeParse(req.params.id);

        if (!id.success) {
            throw new AppError('ID inválido', 400);
        }

        const { nome, conteudo } = await confirmacaoService.relatorioCsv(id.data, req.usuario);

        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="${nome}"`);
        res.set('Cache-Control', 'no-store');
        return res.status(200).send(conteudo);
    } catch (error) {
        next(error);
    }
}

module.exports = { modelo, previa, confirmar, relatorio };
