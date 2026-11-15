const crypto = require('node:crypto');
const repository = require('../repositories/cobrancaTaxaRepository');
const painelRepository = require('../repositories/painelRepository');
const comprovantesStorage = require('../services/storage/comprovantesStorage');
const { detectarTipo, TIPOS, montarChave, tipoDaChave } = require('../utils/comprovanteTaxa');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { hojeSP } = require('../utils/dataSaoPaulo');
const {
    cobrancaTaxaQuerySchema,
    periodoIdParamSchema,
    lancamentoIdParamSchema,
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

        // O lançamento é imutável: o comprovante referenciado tem de existir de fato no bucket.
        if (corpo.comprovante_chave) {
            exigirArmazenamento();
            if (!(await comprovantesStorage.existe(corpo.comprovante_chave))) {
                throw new AppError('Comprovante não encontrado. Envie o arquivo de novo.', 400);
            }
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

function exigirArmazenamento() {
    if (!comprovantesStorage.configurado()) {
        throw new AppError('Armazenamento de comprovantes não configurado. Registre o pagamento sem anexo ou peça a configuração.', 412);
    }
}

// Envia o comprovante para o bucket PRIVADO e devolve a chave a usar no registro do pagamento.
async function enviarComprovante(req, res, next) {
    try {
        const { id } = validar(periodoIdParamSchema, req.params);
        exigirArmazenamento();

        if (!req.file) throw new AppError('Envie o comprovante no campo "arquivo"', 400);

        const contentType = detectarTipo(req.file.buffer);
        if (!contentType) throw new AppError('Comprovante deve ser PDF, JPEG ou PNG', 415);

        const periodo = await repository.periodoParaComprovante(id);
        const chave = montarChave({ empresa_id: periodo.empresa_id, periodo_id: periodo.id, uuid: crypto.randomUUID(), extensao: TIPOS[contentType] });

        await comprovantesStorage.enviar({ chave, buffer: req.file.buffer, contentType });

        return response.success(res, { comprovante_chave: chave }, 201);
    } catch (error) {
        next(error);
    }
}

// Download do comprovante (só operador; nunca URL pública). Cada acesso vai para a trilha.
async function baixarComprovante(req, res, next) {
    try {
        const { id } = validar(lancamentoIdParamSchema, req.params);
        exigirArmazenamento();

        const lancamento = await repository.comprovanteDoLancamento(id);
        const arquivo = await comprovantesStorage.obter(lancamento.comprovante_chave);

        await painelRepository.registrarEvento({
            operador_id: req.operador.id,
            acao: 'taxa_comprovante_baixado',
            alvo_empresa_id: lancamento.empresa_id,
            detalhe: { lancamento_id: lancamento.id, periodo_id: lancamento.periodo_id },
            ip: req.ip
        });

        const contentType = tipoDaChave(lancamento.comprovante_chave);
        res.set({
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="comprovante-lancamento-${lancamento.id}.${TIPOS[contentType] ?? 'bin'}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        if (arquivo.tamanho) res.set('Content-Length', String(arquivo.tamanho));

        arquivo.corpo.on('error', next);
        return arquivo.corpo.pipe(res);
    } catch (error) {
        next(error);
    }
}

module.exports = { resumo, detalhe, fechar, pagamento, perdao, ajuste, enviarComprovante, baixarComprovante };
