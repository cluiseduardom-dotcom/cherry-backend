const criarRateLimiter = require('./loginRateLimiter').criarLoginRateLimiter;

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS_TEST = 1000;

const limit = process.env.NODE_ENV === 'test' ? MAX_ATTEMPTS_TEST : MAX_ATTEMPTS;

module.exports = criarRateLimiter({
    windowMs: WINDOW_MS,
    limit
});
