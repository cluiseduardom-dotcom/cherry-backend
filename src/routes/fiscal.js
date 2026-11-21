const express = require('express');
const router = express.Router();
const controller = require('../controllers/fiscalController');
const requireAdmin = require('../middlewares/requireAdmin');
const requireEstoquista = require('../middlewares/requireEstoquista');

// Preparo fiscal (só cadastro, nenhuma nota é emitida). O app.js exige a funcionalidade `fiscal_cadastro` (o módulo `fiscal`, de emissão, é outro e ainda não existe).
// Dados da empresa e prontidão: só admin. NCM/origem dos produtos: admin e estoquista (é dado de catálogo).
router.get('/empresa', requireAdmin, controller.obterEmpresa);
router.put('/empresa', requireAdmin, controller.salvarEmpresa);
router.get('/prontidao', requireAdmin, controller.prontidao);

router.get('/produtos', requireEstoquista, controller.listarProdutos);
router.post('/produtos/lote', requireEstoquista, controller.aplicarEmLote); // antes de '/produtos/:id'
router.patch('/produtos/:id', requireEstoquista, controller.atualizarProduto);

module.exports = router;
