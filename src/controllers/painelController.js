const AppError = require('../errors/AppError');
const response = require('../utils/response');
const painelAuthService = require('../services/painelAuthService');
const painelEmpresasService = require('../services/painelEmpresasService');
const painelRepository = require('../repositories/painelRepository');
const { loginPainelSchema, token2faSchema, trocarSenhaPainelSchema, criarEmpresaPainelSchema, paginaSchema } = require('../validations/painelValidation');

function ler(schema, dados) {
    const r = schema.safeParse(dados);
    if (!r.success) throw new AppError(r.error.issues[0].message, 400);
    return r.data;
}

const acao = (fn) => async (req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, await fn(req), req.statusPainel ?? 200);
    } catch (error) {
        return next(error);
    }
};

const login = acao((req) => painelAuthService.login(ler(loginPainelSchema, req.body), req.ip));
const iniciar2fa = acao((req) => painelAuthService.iniciar2fa(ler(token2faSchema, req.body).token_2fa));
const confirmar2fa = acao((req) => {
    const { token_2fa, codigo } = ler(token2faSchema, req.body);
    if (!codigo) throw new AppError('Informe o código de 6 dígitos do app', 400);
    return painelAuthService.confirmar2fa(token_2fa, codigo, req.ip);
});
const me = acao((req) => painelAuthService.apresentar(req.operador));
const renovar = acao((req) => painelAuthService.renovar(req.operador));
const trocarSenha = acao((req) => painelAuthService.trocarSenha(req.operador, ler(trocarSenhaPainelSchema, req.body), req.ip));
const criarEmpresa = acao((req) => {
    req.statusPainel = 201;
    return painelEmpresasService.criar(ler(criarEmpresaPainelSchema, req.body), req.operador, req.ip);
});
const eventos = acao((req) => painelRepository.listarEventos(ler(paginaSchema, req.query)));

module.exports = { login, iniciar2fa, confirmar2fa, me, renovar, trocarSenha, criarEmpresa, eventos };
