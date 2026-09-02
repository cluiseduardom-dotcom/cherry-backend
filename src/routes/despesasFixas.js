const express = require('express');
const router = express.Router();
const controller = require('../controllers/despesasFixasController');

router.get('/', controller.listar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.delete('/:id', controller.remover);
router.patch('/:id/toggle', controller.alternarAtivo);

module.exports = router;
