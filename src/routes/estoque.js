const express = require('express');
const router = express.Router();
const controller = require('../controllers/transferenciasEstoqueController');
const requireAdmin = require('../middlewares/requireAdmin');
const exigirFuncionalidade = require('../middlewares/exigirFuncionalidade');

// Maletas e múltiplos locais são a funcionalidade `maletas`: criar local, transferências, conferências e acerto.
// Ler os locais e os saldos (GET /locais, /locais/:id/saldos) continua no núcleo: o estoque central e o PDV os usam.
const maletas = exigirFuncionalidade('maletas');

// Autorização fina (quem cria, aceita, recusa ou cancela) é regra de negócio no service:
// depende do local (dono da maleta) e não só do papel. Aqui só entram usuários autenticados.
router.post('/locais', requireAdmin, maletas, controller.criarLocal);

router.get('/locais', controller.listarLocais);
router.get('/locais/:id/saldos', controller.saldosDoLocal);
router.get('/locais/:id/acerto', maletas, controller.acerto);
router.post('/locais/:id/conferencias', maletas, controller.criarConferencia);
router.get('/locais/:id/conferencias', maletas, controller.listarConferencias);

router.post('/transferencias', maletas, controller.criar);
router.get('/transferencias', maletas, controller.listar);
router.get('/transferencias/:id', maletas, controller.obter);
router.post('/transferencias/:id/aceitar', maletas, controller.aceitar);
router.post('/transferencias/:id/recusar', maletas, controller.recusar);
router.post('/transferencias/:id/cancelar', maletas, controller.cancelar);

module.exports = router;
