const express = require('express');
const router = express.Router();
const controller = require('../controllers/vendasController');

router.get('/resumo', controller.resumo);
router.get('/por-dia', controller.porDia);
router.get('/por-mes', controller.porMes);
router.get('/mais-vendidos', controller.maisVendidos);

router.post('/', controller.criar);

module.exports = router;