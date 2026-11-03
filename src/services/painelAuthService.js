const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const AppError = require('../errors/AppError');
const repo = require('../repositories/painelRepository');
const { obterConfigPainel } = require('../config/painelConfig');
const { cifrar, decifrar } = require('../utils/criptografiaToken');
const totp = require('../utils/totp');

// Login do Painel GiroNex. Sempre três fatores juntos: e-mail + senha + código do app autenticador.
// Primeiro acesso (sem 2FA configurado): o login devolve só um token CURTO de configuração, que serve
// apenas para cadastrar o app; a sessão só nasce depois do primeiro código válido.
// Tokens: assinados com PAINEL_JWT_SECRET (nunca o do ERP) e com "aud" distinto por finalidade.

const AUD_SESSAO = 'gironex-painel';
const AUD_2FA = 'gironex-painel-2fa';
const SESSAO_EXPIRA = '30m';
const CONFIG_2FA_EXPIRA = '10m';
const ALG = 'HS256';
const MENSAGEM = 'E-mail, senha ou código inválidos';
const HASH_DESCARTAVEL = bcrypt.hashSync('hash-descartavel-painel', 10);

function config() {
    const c = obterConfigPainel();
    if (!c) throw new AppError('Painel indisponível: configuração ausente no servidor', 503);
    return c;
}

function emitir(operador, aud, expiresIn) {
    return jwt.sign(
        { op: operador.id, tv: operador.token_version ?? 0, st: operador.senha_temporaria === true },
        config().jwtSecret,
        { audience: aud, expiresIn, algorithm: ALG }
    );
}

function verificar(token, aud) {
    try {
        return jwt.verify(token, config().jwtSecret, { audience: aud, algorithms: [ALG] });
    } catch {
        throw new AppError('Sessão do painel inválida ou expirada', 401);
    }
}

function apresentar(op) {
    return { id: op.id, nome: op.nome, email: op.email, senha_temporaria: op.senha_temporaria === true };
}

async function login({ email, senha, codigo }, ip) {
    config();
    const op = await repo.buscarPorEmail(email);
    const senhaOk = await bcrypt.compare(String(senha ?? ''), op ? op.senha : HASH_DESCARTAVEL);

    if (!op || !senhaOk || op.ativo !== true) {
        await repo.registrarEvento({ operador_id: op?.id ?? null, acao: 'login_recusado', detalhe: { email: String(email).trim().toLowerCase().slice(0, 254) }, ip });
        throw new AppError(MENSAGEM, 401);
    }

    if (!op.totp_ativo) {
        return { etapa: 'configurar_2fa', token_2fa: emitir(op, AUD_2FA, CONFIG_2FA_EXPIRA) };
    }

    const passo = totp.verificarCodigo(decifrar(op.totp_segredo, config().encKey), codigo);

    if (passo === null || !(await repo.consumirPasso(op.id, passo))) {
        await repo.registrarEvento({ operador_id: op.id, acao: 'login_recusado', detalhe: { motivo: 'codigo' }, ip });
        throw new AppError(MENSAGEM, 401);
    }

    await repo.registrarEvento({ operador_id: op.id, acao: 'login', ip });

    return { etapa: 'ok', token: emitir(op, AUD_SESSAO, SESSAO_EXPIRA), operador: apresentar(op) };
}

async function operadorDoToken2fa(token2fa) {
    const p = verificar(token2fa, AUD_2FA);
    const op = await repo.buscarPorId(p.op);
    if (!op || op.ativo !== true || op.token_version !== p.tv) throw new AppError('Sessão do painel inválida ou expirada', 401);
    if (op.totp_ativo) throw new AppError('A verificação em duas etapas já está configurada', 409);
    return op;
}

async function iniciar2fa(token2fa) {
    const op = await operadorDoToken2fa(token2fa);
    const segredo = totp.gerarSegredo();
    await repo.guardarSegredoPendente(op.id, cifrar(segredo, config().encKey));
    return { segredo, otpauth: totp.uriOtpauth({ conta: op.email, segredo }) };
}

async function confirmar2fa(token2fa, codigo, ip) {
    const op = await operadorDoToken2fa(token2fa);
    if (!op.totp_segredo) throw new AppError('Comece a configuração do app autenticador primeiro', 409);

    const passo = totp.verificarCodigo(decifrar(op.totp_segredo, config().encKey), codigo);
    if (passo === null || !(await repo.ativarTotp(op.id, passo))) throw new AppError('Código inválido. Confira o relógio do celular e tente de novo.', 401);

    await repo.registrarEvento({ operador_id: op.id, acao: '2fa_configurado', ip });

    return { etapa: 'ok', token: emitir(op, AUD_SESSAO, SESSAO_EXPIRA), operador: apresentar(op) };
}

// Sessão: assinatura + estado atual no banco (ativo, token_version). Senha temporária só deixa trocar a senha.
async function operadorDaSessao(token) {
    const p = verificar(token, AUD_SESSAO);
    const op = await repo.buscarPorId(p.op);
    if (!op || op.ativo !== true || op.token_version !== p.tv || !op.totp_ativo) throw new AppError('Sessão do painel inválida ou expirada', 401);
    return op;
}

function renovar(op) {
    return { token: emitir(op, AUD_SESSAO, SESSAO_EXPIRA), operador: apresentar(op) };
}

async function trocarSenha(op, { senha_atual, nova_senha }, ip) {
    const ok = await bcrypt.compare(String(senha_atual ?? ''), op.senha);
    if (!ok) throw new AppError('Senha atual inválida', 403);
    if (await bcrypt.compare(nova_senha, op.senha)) throw new AppError('A nova senha deve ser diferente da atual', 400);

    const atualizado = await repo.trocarSenha(op.id, await bcrypt.hash(nova_senha, 12));
    await repo.registrarEvento({ operador_id: op.id, acao: 'senha_alterada', ip });

    return renovar(atualizado);
}

module.exports = { login, iniciar2fa, confirmar2fa, operadorDaSessao, renovar, trocarSenha, apresentar, AUD_SESSAO, AUD_2FA };
