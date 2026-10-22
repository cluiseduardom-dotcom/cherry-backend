const express = require('express');
const router = express.Router();
const controller = require('../controllers/privilegiosController');
const confirmacaoSenhaRateLimiter = require('../middlewares/confirmacaoSenhaRateLimiter');

// O mount (app.js) já é authMiddleware + requireCapacidade('conceder_admin').
router.get('/administradores', controller.listarAdministradores);
router.get('/usuarios', controller.listarUsuarios);
router.get('/historico', controller.historico);

// Conceder/revogar pedem a senha de quem executa: limitadas por usuário.
router.post('/usuarios/:usuarioId/administrador', confirmacaoSenhaRateLimiter, controller.concederAUsuario);
router.post('/usuarios/:usuarioId/administrador/revogar', confirmacaoSenhaRateLimiter, controller.revogarDeUsuario);
router.post('/cargos/:cargo/administrador', confirmacaoSenhaRateLimiter, controller.concederACargo);
router.post('/cargos/:cargo/administrador/revogar', confirmacaoSenhaRateLimiter, controller.revogarDeCargo);

module.exports = router;
