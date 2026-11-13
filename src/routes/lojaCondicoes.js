const express = require('express');
const controller = require('../controllers/lojaCondicoesController');

const router = express.Router();

// Condições de venda da loja (frete grátis, garantia, embalagem de presente). Autenticação, papel (admin) e funcionalidade
// `loja_online` são exigidos em app.js.
router.get('/', controller.buscar);
router.put('/', controller.salvar);

module.exports = router;
