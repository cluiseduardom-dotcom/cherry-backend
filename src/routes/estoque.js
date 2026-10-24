const express = require('express');
const router = express.Router();
const controller = require('../controllers/transferenciasEstoqueController');
const requireAdmin = require('../middlewares/requireAdmin');

// Autorização fina (quem cria, aceita, recusa ou cancela) é regra de negócio no service:
// depende do local (dono da maleta) e não só do papel. Aqui só entram usuários autenticados.
router.post('/locais', requireAdmin, controller.criarLocal);

router.get('/locais/:id/acerto', controller.acerto);
router.post('/locais/:id/conferencias', controller.criarConferencia);
router.get('/locais/:id/conferencias', controller.listarConferencias);

router.post('/transferencias', controller.criar);
router.get('/transferencias', controller.listar);
router.get('/transferencias/:id', controller.obter);
router.post('/transferencias/:id/aceitar', controller.aceitar);
router.post('/transferencias/:id/recusar', controller.recusar);
router.post('/transferencias/:id/cancelar', controller.cancelar);

module.exports = router;
