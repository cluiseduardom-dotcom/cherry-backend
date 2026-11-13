const express = require('express');
const controller = require('../controllers/lojaHomeVendasController');

const router = express.Router();

// Seção comercial da Home da loja (liga/desliga e textos). Autenticação, papel (admin) e funcionalidade `loja_online`
// são exigidos em app.js.
router.get('/', controller.buscar);
router.put('/', controller.salvar);

module.exports = router;
