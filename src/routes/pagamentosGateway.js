const express = require('express');
const router = express.Router();
const controller = require('../controllers/mercadoPagoController');

// O mount (app.js) já é authMiddleware + requireVendedor (admin e vendedor). Empresa sempre do JWT.
router.get('/disponibilidade', controller.disponibilidade);
router.post('/pix', controller.criarPix);
router.get('/:codigo', controller.consultarCobranca);

module.exports = router;
