const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/publicoController');

const router = express.Router();

// Rotas SEM autenticação. Cada uma deve devolver o mínimo e ter o próprio teto por IP.
const LIMITE_POR_MINUTO = process.env.NODE_ENV === 'test' ? 10000 : 60;

const limiteMarca = rateLimit({
    windowMs: 60 * 1000,
    limit: LIMITE_POR_MINUTO,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => rateLimit.ipKeyGenerator(req.ip),
    handler: (req, res) => res.status(429).json({ success: false, message: 'Muitas requisições. Tente novamente em instantes.' })
});

router.get('/marca/:slug', limiteMarca, controller.marca);

module.exports = router;
