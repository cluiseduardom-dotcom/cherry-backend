const express = require('express');
const router = express.Router();
const controller = require('../controllers/importacaoListaController');
const uploadImportacaoLista = require('../middlewares/uploadImportacaoLista');
const importacaoListaRateLimiter = require('../middlewares/importacaoListaRateLimiter');

// Autenticação, papel admin e a funcionalidade `importacao_lista` são aplicados no app.js.
router.get('/modelo', controller.modelo);
router.post('/previa', importacaoListaRateLimiter, uploadImportacaoLista, controller.previa);

module.exports = router;
