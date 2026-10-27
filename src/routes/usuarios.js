const express = require('express');
const router = express.Router();
const controller = require('../controllers/usuariosController');
const requireAdmin = require('../middlewares/requireAdmin');
const confirmacaoSenhaRateLimiter = require('../middlewares/confirmacaoSenhaRateLimiter');

// O mount (app.js) já é authMiddleware + requireCapacidade('gerir_usuarios') (Admin tem todas).
// A hierarquia (só cargos abaixo do seu nível, nunca Admin, nunca a si mesmo) é decidida no
// service/repository, sobre o cargo efetivo lido do banco.
router.get('/', controller.listar);
router.get('/cargos', controller.cargosAtribuiveis);
router.post('/', controller.criar);
router.get('/eventos', controller.eventos);
router.get('/:id', controller.detalhar);
router.patch('/:id/dados', controller.editarDados);
router.patch('/:id/bloqueio', controller.bloquear);
// Redefinir senha segue só com admin (não basta a capacidade gerir_usuarios) e pede a senha do admin.
router.post('/:id/redefinir-senha', requireAdmin, confirmacaoSenhaRateLimiter, controller.redefinirSenha);

module.exports = router;
