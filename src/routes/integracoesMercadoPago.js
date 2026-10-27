const express = require('express');
const router = express.Router();
const controller = require('../controllers/mercadoPagoController');
const authMiddleware = require('../middlewares/authMiddleware');
const requireAdmin = require('../middlewares/requireAdmin');
const { criarLimiterPorIp } = require('../middlewares/loginRateLimiter');

const limiterCallback = criarLimiterPorIp({
    windowMs: 15 * 60 * 1000,
    limit: process.env.NODE_ENV === 'test' ? 1000 : 30,
    contarSucessos: true
});

// Retorno do OAuth: público (vem do navegador, sem JWT); a identidade é o `state` de uso único.
router.get('/callback', limiterCallback, controller.callback);

// O resto é só do admin da empresa.
router.use(authMiddleware, requireAdmin);
router.get('/', controller.status);
router.post('/conectar', controller.conectar);
router.delete('/', controller.desconectar);

module.exports = router;
