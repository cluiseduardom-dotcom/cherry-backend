const express = require('express');
const router = express.Router();
const controller = require('../controllers/mercadoPagoController');

// Público: a proteção é a assinatura do Mercado Pago (x-signature), validada no controller.
router.post('/', controller.webhook);

module.exports = router;
