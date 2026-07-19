const express = require('express');
const router = express.Router();
const controller = require('../controllers/clientesController');

router.post('/', controller.criar);
router.get('/', controller.listar);
router.get('/ranking', controller.ranking);
router.get('/:id/total-gasto', controller.totalGasto);
router.get('/:id/historico', controller.historico);

module.exports = router;