const express = require('express');
const router = express.Router();
const controller = require('../controllers/clientesController');
const requireAdmin = require('../middlewares/requireAdmin');

router.post('/', controller.criar);
router.get('/', controller.listar);
router.get('/ranking', controller.ranking);
router.get('/:id/total-gasto', controller.totalGasto);
router.get('/:id/historico', controller.historico);
router.patch('/:id/anonimizar', requireAdmin, controller.anonimizar);

module.exports = router;