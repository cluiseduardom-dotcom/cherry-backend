const express = require('express');
const router = express.Router();
const pontoEquilibrioController = require('../controllers/pontoEquilibrioController');
const fluxoCaixaController = require('../controllers/fluxoCaixaController');

router.get('/ponto-equilibrio', pontoEquilibrioController.calcular);
router.get('/fluxo-caixa', fluxoCaixaController.resumo);

module.exports = router;
