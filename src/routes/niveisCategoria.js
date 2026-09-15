const express = require('express');
const router = express.Router();
const controller = require('../controllers/niveisCategoriaController');

router.get('/', controller.listar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.delete('/:id', controller.remover);

module.exports = router;
