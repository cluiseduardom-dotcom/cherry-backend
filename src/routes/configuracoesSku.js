const express = require('express');
const router = express.Router();
const controller = require('../controllers/configuracoesSkuController');

router.get('/', controller.listar);
router.put('/', controller.salvar);

module.exports = router;
