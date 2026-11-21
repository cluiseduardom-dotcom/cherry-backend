const express = require('express');
const router = express.Router();
const controller = require('../controllers/pedidosCompraController');

router.get('/', controller.listar);
router.post('/', controller.criar);
router.get('/:id', controller.buscarPorId);
router.put('/:id', controller.atualizar);
router.post('/:id/enviar', controller.enviar);
router.post('/:id/confirmar', controller.confirmar);
router.post('/:id/cancelar', controller.cancelar);

module.exports = router;
