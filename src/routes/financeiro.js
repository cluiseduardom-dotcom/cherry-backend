const express = require('express');
const router = express.Router();
const pontoEquilibrioController = require('../controllers/pontoEquilibrioController');
const fluxoCaixaController = require('../controllers/fluxoCaixaController');
const taxasVendaController = require('../controllers/taxasVendaController');
const exigirFuncionalidade = require('../middlewares/exigirFuncionalidade');

// Só o ponto de equilíbrio é da funcionalidade `analise_financeira`; fluxo de caixa e taxas ficam no núcleo.
router.get('/ponto-equilibrio', exigirFuncionalidade('analise_financeira'), pontoEquilibrioController.calcular);
router.get('/fluxo-caixa', fluxoCaixaController.resumo);
// Taxas internas da plataforma geradas nas vendas do tenant. Leitura apenas;
// o mount /financeiro já é authMiddleware + requireAdmin.
router.get('/taxas-venda', taxasVendaController.listar);

module.exports = router;
