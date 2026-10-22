const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FALHAS = 5;
const MAX_FALHAS_TESTE = 1000;

// Rotas que pedem a senha de quem executa (conceder/revogar Admin) são um alvo para quem
// roubou uma sessão e tenta adivinhar a senha. A chave é o USUÁRIO autenticado (não o IP):
// só respostas de erro contam (skipSuccessfulRequests), então o uso legítimo não consome a cota.
// Deve ficar DEPOIS do authMiddleware.
module.exports = rateLimit({
    windowMs: WINDOW_MS,
    limit: process.env.NODE_ENV === 'test' ? MAX_FALHAS_TESTE : MAX_FALHAS,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `confirmacao-senha|${req.usuario ? `${req.usuario.empresa_id}:${req.usuario.id}` : 'anonimo'}`,
    handler: (req, res) => {
        res.status(429).json({ success: false, message: 'Muitas tentativas. Tente novamente em alguns minutos.' });
    }
});
