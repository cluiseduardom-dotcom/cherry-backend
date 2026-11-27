const repository = require('../repositories/caixaRepository');
const AppError = require('../errors/AppError');
const response = require('../utils/response');
const { temCapacidade } = require('../services/permissoesService');
const { CAPACIDADES } = require('../constants/cargos');
const {
    CHAVE_IDEMPOTENCIA, caixaCriarSchema, caixaAtualizarSchema, abrirSessaoSchema, movimentoSchema, fechamentoSchema, sessoesQuerySchema
} = require('../validations/caixaValidation');

// Caixa por PDV. Autenticação, funcionalidade `caixa` e a capacidade mínima (operar_caixa OU gerir_caixas) são exigidas em app.js.
// empresa_id e usuário vêm SEMPRE do JWT. Quem só opera enxerga e mexe apenas na própria sessão; quem gere, em todas.
const gere = (usuario) => temCapacidade(usuario, CAPACIDADES.GERIR_CAIXAS);

function parseId(valor) {
    const id = Number(valor);

    if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido', 400);

    return id;
}

function ler(schema, dados) {
    const resultado = schema.safeParse(dados ?? {});

    if (!resultado.success) throw new AppError(resultado.error.issues[0].message, 400);

    return resultado.data;
}

function chaveDeIdempotencia(req) {
    const chave = (req.get('Idempotency-Key') ?? '').trim();

    if (!CHAVE_IDEMPOTENCIA.test(chave)) {
        throw new AppError('Cabeçalho Idempotency-Key obrigatório (8 a 80 letras, números, hífen ou sublinhado)', 400);
    }

    return chave;
}

const semCache = (res) => res.set('Cache-Control', 'no-store');

async function listarCaixas(req, res, next) {
    try {
        semCache(res);
        return response.success(res, { caixas: await repository.listarCaixas({ empresa_id: req.usuario.empresa_id, incluirInativos: gere(req.usuario) }) });
    } catch (error) { next(error); }
}

async function criarCaixa(req, res, next) {
    try {
        const corpo = ler(caixaCriarSchema, req.body);

        return response.success(res, { caixa: await repository.criarCaixa({ empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, nome: corpo.nome }) }, 201);
    } catch (error) { next(error); }
}

async function atualizarCaixa(req, res, next) {
    try {
        const corpo = ler(caixaAtualizarSchema, req.body);

        return response.success(res, { caixa: await repository.atualizarCaixa({ empresa_id: req.usuario.empresa_id, caixa_id: parseId(req.params.id), ativo: corpo.ativo }) });
    } catch (error) { next(error); }
}

async function abrirSessao(req, res, next) {
    try {
        if (!temCapacidade(req.usuario, CAPACIDADES.OPERAR_CAIXA)) throw new AppError('Acesso negado', 403);

        const corpo = ler(abrirSessaoSchema, req.body);
        const resultado = await repository.abrirSessao({ empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, caixa_id: corpo.caixa_id, saldo_inicial: corpo.saldo_inicial });

        semCache(res);
        if (resultado.reaproveitada) res.set('Idempotent-Replayed', 'true');

        return response.success(res, { sessao: resultado.sessao }, resultado.reaproveitada ? 200 : 201);
    } catch (error) { next(error); }
}

// A sessão aberta do próprio operador (null quando não há): é o que o PDV consulta ao abrir a tela.
async function sessaoAtual(req, res, next) {
    try {
        semCache(res);
        return response.success(res, { atual: await repository.sessaoAberta({ empresa_id: req.usuario.empresa_id, operador_id: req.usuario.id }) });
    } catch (error) { next(error); }
}

async function listarSessoes(req, res, next) {
    try {
        const q = ler(sessoesQuerySchema, req.query);
        const { itens, total } = await repository.listarSessoes({
            empresa_id: req.usuario.empresa_id, operador_id: gere(req.usuario) ? null : req.usuario.id,
            status: q.status ?? null, caixa_id: q.caixa_id ?? null, limit: q.pageSize, offset: (q.page - 1) * q.pageSize
        });

        semCache(res);
        return response.success(res, { itens, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
    } catch (error) { next(error); }
}

async function detalharSessao(req, res, next) {
    try {
        const detalhe = await repository.detalharSessao({ empresa_id: req.usuario.empresa_id, sessao_id: parseId(req.params.id) });

        // Sessão de outro operador "não existe" para quem não gere os caixas.
        if (!detalhe || (!gere(req.usuario) && detalhe.sessao.operador_id !== req.usuario.id)) throw new AppError('Sessão de caixa não encontrada', 404);

        semCache(res);
        return response.success(res, detalhe);
    } catch (error) { next(error); }
}

async function lancarMovimento(req, res, next) {
    try {
        const corpo = ler(movimentoSchema, req.body);
        const resultado = await repository.lancarMovimento({
            empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, gere: gere(req.usuario), sessao_id: parseId(req.params.id),
            tipo: corpo.tipo, valor: corpo.valor, motivo: corpo.motivo, chave: chaveDeIdempotencia(req)
        });

        semCache(res);
        if (resultado.reaproveitado) res.set('Idempotent-Replayed', 'true');

        return response.success(res, { movimento: resultado.movimento }, resultado.reaproveitado ? 200 : 201);
    } catch (error) { next(error); }
}

async function fecharSessao(req, res, next) {
    try {
        const corpo = ler(fechamentoSchema, req.body);
        const resultado = await repository.fecharSessao({
            empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, gere: gere(req.usuario), sessao_id: parseId(req.params.id),
            conferencia: corpo.conferencia, justificativa: corpo.justificativa
        });

        semCache(res);
        return response.success(res, {
            ...resultado,
            aviso: resultado.divergente ? 'O caixa foi fechado com diferença; a justificativa ficou registrada.' : null
        });
    } catch (error) { next(error); }
}

module.exports = { listarCaixas, criarCaixa, atualizarCaixa, abrirSessao, sessaoAtual, listarSessoes, detalharSessao, lancarMovimento, fecharSessao };
