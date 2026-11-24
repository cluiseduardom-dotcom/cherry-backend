const express = require('express');
const router = express.Router();
const controller = require('../controllers/unidadesController');

// Autenticação já vem do app.js (authMiddleware); o escopo por empresa é do JWT dentro do controller/repository.
router.get('/', controller.listar);
router.get('/buscar/:identificador', controller.buscarPorIdentificador);

module.exports = router;
