const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_ATTEMPTS_TEST = 1000;

function criarLoginRateLimiter({ windowMs = WINDOW_MS, limit = MAX_ATTEMPTS } = {}) {

    return rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({
                success: false,
                message: 'Muitas tentativas de login. Tente novamente em alguns minutos.'
            });
        }
    });

}

const limit = process.env.NODE_ENV === 'test' ? MAX_ATTEMPTS_TEST : MAX_ATTEMPTS;

module.exports = criarLoginRateLimiter({ windowMs: WINDOW_MS, limit });
module.exports.criarLoginRateLimiter = criarLoginRateLimiter;
