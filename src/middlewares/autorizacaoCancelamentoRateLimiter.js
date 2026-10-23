const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FALHAS = 5;
const MAX_FALHAS_TESTE = 1000;

// O cancelamento de venda antiga pede a senha de OUTRA pessoa: é o ponto onde uma sessão roubada
// poderia tentar adivinhar senhas de supervisores. Conta por USUÁRIO autenticado (não por IP) e só
// as recusas de autorização (403); erro de validação, venda inexistente ou cancelamento que deu
// certo não consomem a cota, para não travar a operação da loja. Fica DEPOIS do authMiddleware e da
// checagem de capacidade (um 403 de permissão não passa por aqui).
module.exports = rateLimit({
    windowMs: WINDOW_MS,
    limit: process.env.NODE_ENV === 'test' ? MAX_FALHAS_TESTE : MAX_FALHAS,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode !== 403,
    keyGenerator: (req) => `cancelamento-autorizacao|${req.usuario ? `${req.usuario.empresa_id}:${req.usuario.id}` : 'anonimo'}`,
    handler: (req, res) => {
        res.status(429).json({ success: false, message: 'Muitas tentativas. Tente novamente em alguns minutos.' });
    }
});
