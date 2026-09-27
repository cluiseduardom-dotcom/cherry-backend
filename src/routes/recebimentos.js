const express = require('express');
const router = express.Router();
const controller = require('../controllers/recebimentosController');

router.get('/', controller.listar);
router.post('/', controller.criar);
router.get('/:id', controller.obter);
router.post('/:id/itens', controller.adicionarItem);
router.patch('/:id/status', controller.alterarStatus);
router.post('/:id/aprovar', controller.aprovar);

module.exports = router;
