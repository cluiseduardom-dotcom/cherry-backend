const rateLimit = require('express-rate-limit');
const { LIMITES } = require('../constants/importacaoLista');

const WINDOW_MS = 60 * 60 * 1000;
const LIMITE_TESTE = 1000;

// A prévia lê e valida até 2.000 linhas e guarda dados pessoais por 30 min: a cota é POR EMPRESA (não por IP nem por
// usuário), contando toda tentativa. Deve ficar DEPOIS do authMiddleware.
module.exports = rateLimit({
    windowMs: WINDOW_MS,
    limit: process.env.NODE_ENV === 'test' ? LIMITE_TESTE : LIMITES.PREVIAS_POR_HORA,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `importacao-previa|${req.usuario ? req.usuario.empresa_id : 'anonimo'}`,
    handler: (req, res) => {
        res.status(429).json({ success: false, message: 'Muitas importações em pouco tempo. Tente novamente em alguns minutos.' });
    }
});
