const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_ATTEMPTS_POR_IP = 30;
const MAX_ATTEMPTS_TEST = 1000;

function handler(req, res) {
    res.status(429).json({
        success: false,
        message: 'Muitas tentativas de login. Tente novamente em alguns minutos.'
    });
}

function emailDaRequisicao(req) {
    const email = req.body && req.body.email;

    return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
}

// Chave por IP + e-mail: errar a senha de uma conta só bloqueia essa conta
// vinda desse IP, nunca os demais usuários. Só falhas contam
// (skipSuccessfulRequests), então um login legítimo não consome a cota.
function criarLoginRateLimiter({ windowMs = WINDOW_MS, limit = MAX_ATTEMPTS } = {}) {

    return rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        keyGenerator: (req) => `${rateLimit.ipKeyGenerator(req.ip)}|${emailDaRequisicao(req)}`,
        handler
    });

}

// Teto por IP, bem mais folgado, só para limitar credential stuffing que gira
// e-mails a partir de um único IP. Não é global: cada IP tem a sua cota.
function criarLimiterPorIp({ windowMs = WINDOW_MS, limit = MAX_ATTEMPTS_POR_IP, contarSucessos = false } = {}) {

    return rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: !contarSucessos,
        keyGenerator: (req) => rateLimit.ipKeyGenerator(req.ip),
        handler
    });

}

const emTeste = process.env.NODE_ENV === 'test';

const porEmail = criarLoginRateLimiter({ windowMs: WINDOW_MS, limit: emTeste ? MAX_ATTEMPTS_TEST : MAX_ATTEMPTS });
const porIp = criarLimiterPorIp({ windowMs: WINDOW_MS, limit: emTeste ? MAX_ATTEMPTS_TEST : MAX_ATTEMPTS_POR_IP });

module.exports = [porIp, porEmail];
module.exports.criarLoginRateLimiter = criarLoginRateLimiter;
module.exports.criarLimiterPorIp = criarLimiterPorIp;
