const contasReceberService = require('../services/contasReceberService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { listarContasReceberSchema, receberContaSchema, CHAVE_IDEMPOTENCIA } = require('../validations/contasReceberValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

function parsePaginacao(query) {
    let page = parseInt(query.page, 10);
    let pageSize = parseInt(query.pageSize, 10);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;

    return { page, pageSize };
}

async function listar(req, res, next) {
    try {
        const paginacao = parsePaginacao(req.query);

        const parsedFiltros = listarContasReceberSchema.safeParse({
            status: req.query.status,
            vencimento_de: req.query.vencimento_de,
            vencimento_ate: req.query.vencimento_ate
        });

        if (!parsedFiltros.success) {
            throw new AppError(parsedFiltros.error.issues[0].message, 400);
        }

        const resultado = await contasReceberService.listar({
            ...paginacao,
            status: parsedFiltros.data.status,
            vencimentoDe: parsedFiltros.data.vencimento_de,
            vencimentoAte: parsedFiltros.data.vencimento_ate
        }, req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function buscarPorId(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const conta = await contasReceberService.buscarPorId(id, req.usuario.empresa_id);

        return response.success(res, conta);
    } catch (error) {
        next(error);
    }
}

async function marcarComoRecebida(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const conta = await contasReceberService.marcarComoRecebida(id, req.usuario.empresa_id, req.usuario.id);

        return response.success(res, conta);
    } catch (error) {
        next(error);
    }
}

// Recebimento total ou parcial. Idempotency-Key obrigatório: o mesmo clique repetido nunca lança o dinheiro duas vezes.
async function receber(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const chave = (req.get('Idempotency-Key') ?? '').trim();

        if (!CHAVE_IDEMPOTENCIA.test(chave)) {
            throw new AppError('Cabeçalho Idempotency-Key obrigatório (8 a 80 letras, números, hífen ou sublinhado)', 400);
        }

        const corpo = receberContaSchema.safeParse(req.body ?? {});

        if (!corpo.success) throw new AppError(corpo.error.issues[0].message, 400);

        const resultado = await contasReceberService.receber(id, { ...corpo.data, chave }, req.usuario);

        res.set('Cache-Control', 'no-store');
        if (resultado.reaproveitado) res.set('Idempotent-Replayed', 'true');

        return response.success(res, { conta: resultado.conta, recebimento: resultado.recebimento }, resultado.reaproveitado ? 200 : 201);
    } catch (error) {
        next(error);
    }
}

async function listarRecebimentos(req, res, next) {
    try {
        const id = parseId(req.params.id);

        res.set('Cache-Control', 'no-store');
        return response.success(res, await contasReceberService.listarRecebimentos(id, req.usuario.empresa_id));
    } catch (error) {
        next(error);
    }
}

module.exports = {
    listar,
    buscarPorId,
    marcarComoRecebida,
    receber,
    listarRecebimentos
};
