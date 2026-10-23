const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const internoController = require('../controllers/internoController');
const protegerInterno = require('../middlewares/protegerInterno');

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: process.env.NODE_ENV === 'test' ? 1000 : 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => rateLimit.ipKeyGenerator(req.ip),
    handler: (req, res) => res.status(429).json({ success: false, message: 'Muitas requisições. Tente novamente em alguns minutos.' })
});

// Painel interno da GiroOne (ADR-007): fora do JWT de tenant, protegido por segredo de servidor.
// O limite vem ANTES da checagem do segredo para também frear tentativa de adivinhação.
router.use(limiter, protegerInterno);

router.get('/empresas', internoController.listarEmpresas);
router.put('/empresas/:id/tema', internoController.definirTema);
router.put('/empresas/:id/modulos/:modulo', internoController.definirModulo);

module.exports = router;
