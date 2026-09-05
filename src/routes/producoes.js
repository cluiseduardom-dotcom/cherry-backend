const express = require('express');
const router = express.Router();
const controller = require('../controllers/producoesController');

router.get('/', controller.listar);
router.post('/', controller.criar);
router.get('/:id', controller.buscarPorId);
router.patch('/:id/cancelar', controller.cancelar);

module.exports = router;
