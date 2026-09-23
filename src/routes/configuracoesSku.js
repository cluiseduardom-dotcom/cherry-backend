const express = require('express');
const router = express.Router();
const controller = require('../controllers/configuracoesSkuController');

router.get('/', controller.listar);
router.get('/padroes', controller.listarTodos);
router.put('/', controller.salvar);

module.exports = router;
