const express = require('express');
const router = express.Router();
const controller = require('../controllers/empresaController');

// O mount (app.js) já é authMiddleware + requireAdmin. A empresa vem sempre do JWT.
router.get('/dados', controller.obterDados);
router.patch('/dados', controller.atualizarDados);

module.exports = router;
