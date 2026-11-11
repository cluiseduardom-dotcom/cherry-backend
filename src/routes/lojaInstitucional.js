const express = require('express');
const controller = require('../controllers/lojaInstitucionalController');

const router = express.Router();

// Dados institucionais da loja (história, serviços, atendimento, redes, empresa). Autenticação, papel (admin) e
// funcionalidade `loja_online` são exigidos em app.js.
router.get('/', controller.buscar);
router.put('/', controller.salvar);

module.exports = router;
