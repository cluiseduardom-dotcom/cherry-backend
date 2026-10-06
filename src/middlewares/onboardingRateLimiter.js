const { criarLimiterPorIp } = require('./loginRateLimiter');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS_TEST = 1000;

const limit = process.env.NODE_ENV === 'test' ? MAX_ATTEMPTS_TEST : MAX_ATTEMPTS;

// Onboarding cria empresa: cota estrita por IP real (trust proxy configurado
// em app.js). Aqui contam também os sucessos — cada sucesso cria um tenant.
module.exports = criarLimiterPorIp({ windowMs: WINDOW_MS, limit, contarSucessos: true });
