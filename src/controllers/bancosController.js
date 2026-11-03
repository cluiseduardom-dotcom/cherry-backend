const AppError = require('../errors/AppError');
const response = require('../utils/response');
const contasService = require('../services/contasBancariasService');
const movimentosService = require('../services/movimentosBancariosService');
const conciliacaoService = require('../services/conciliacaoBancariaService');
const v = require('../validations/bancosValidation');

function ler(schema, dados) {
    const r = schema.safeParse(dados);
    if (!r.success) throw new AppError(r.error.issues[0].message, 400);
    return r.data;
}

const idDaRota = (req) => ler(v.idPositivo('Identificador'), req.params.id);

// Todas as rotas passam por authMiddleware + requireCapacidade(gerir_financeiro) no mount; empresa_id e o
// usuário vêm do JWT (req.usuario), nunca do corpo.
const acao = (fn, status = 200) => async (req, res, next) => {
    try {
        return response.success(res, await fn(req), status);
    } catch (erro) {
        return next(erro);
    }
};

const listarContas = acao((req) => contasService.listarComSaldo(ler(v.listarContasSchema, req.query), req.usuario));
const buscarConta = acao((req) => contasService.buscarComSaldo(idDaRota(req), req.usuario));
const criarConta = acao((req) => contasService.criar(ler(v.criarContaSchema, req.body), req.usuario), 201);
const atualizarConta = acao((req) => contasService.atualizar(idDaRota(req), ler(v.atualizarContaSchema, req.body), req.usuario));
const statusConta = acao((req) => contasService.atualizarStatus(idDaRota(req), ler(v.statusContaSchema, req.body).status, req.usuario));

const listarMovimentos = acao((req) => movimentosService.listar(ler(v.listarMovimentosSchema, req.query), req.usuario));
const lancarMovimento = acao((req) => movimentosService.lancarManual(ler(v.criarMovimentoSchema, req.body), req.usuario), 201);
const cancelarMovimento = acao((req) => movimentosService.cancelar(idDaRota(req), ler(v.cancelarMovimentoSchema, req.body).motivo, req.usuario));

const listarConciliacoes = acao((req) => conciliacaoService.listar({}, req.usuario));
const conciliar = acao((req) => conciliacaoService.conciliar(ler(v.conciliarSchema, req.body), req.usuario), 201);
const desfazerConciliacao = acao((req) => conciliacaoService.desfazer(idDaRota(req), req.usuario));

module.exports = {
    listarContas, buscarConta, criarConta, atualizarConta, statusConta,
    listarMovimentos, lancarMovimento, cancelarMovimento,
    listarConciliacoes, conciliar, desfazerConciliacao
};
