const express = require('express');
const router = express.Router();
const controller = require('../controllers/plataformaController');

// O mount (app.js) já é authMiddleware + requirePlataformaAdmin. Somente leitura.
router.get('/taxas', controller.taxasPorEmpresa);

module.exports = router;
