const express = require('express');
const router = express.Router();
const controller = require('../controllers/configuracoesFinanceirasController');

router.get('/', controller.obter);
router.put('/', controller.atualizar);

module.exports = router;
