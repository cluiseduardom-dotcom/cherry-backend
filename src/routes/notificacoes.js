const express = require('express');
const router = express.Router();
const controller = require('../controllers/notificacoesController');

// Qualquer usuário autenticado; o conteúdo é filtrado por perfil no service.
router.get('/', controller.listar);

module.exports = router;
