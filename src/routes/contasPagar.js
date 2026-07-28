const express = require('express');
const router = express.Router();
const controller = require('../controllers/contasPagarController');

router.get('/', controller.listar);
router.post('/', controller.criar);

router.get('/:id', controller.buscarPorId);
router.put('/:id', controller.atualizar);
router.patch('/:id/pagar', controller.marcarComoPaga);
router.delete('/:id', controller.cancelar);

module.exports = router;
