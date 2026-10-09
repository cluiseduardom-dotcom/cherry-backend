const express = require('express');
const router = express.Router();
const pontoEquilibrioController = require('../controllers/pontoEquilibrioController');
const fluxoCaixaController = require('../controllers/fluxoCaixaController');
const taxasVendaController = require('../controllers/taxasVendaController');

router.get('/ponto-equilibrio', pontoEquilibrioController.calcular);
router.get('/fluxo-caixa', fluxoCaixaController.resumo);
// Taxas internas da plataforma geradas nas vendas do tenant. Leitura apenas;
// o mount /financeiro já é authMiddleware + requireAdmin.
router.get('/taxas-venda', taxasVendaController.listar);

module.exports = router;
