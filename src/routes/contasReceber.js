const express = require('express');
const router = express.Router();
const controller = require('../controllers/contasReceberController');

router.get('/', controller.listar);

router.get('/:id', controller.buscarPorId);
router.patch('/:id/receber', controller.marcarComoRecebida);

module.exports = router;
