const express = require('express');
const router = express.Router();
const controller = require('../controllers/consumosController');

// Montado em /consumos com authMiddleware + requireEstoquista (admin e estoquista). Vendedor = 403.
router.get('/insumos', controller.listarInsumos);
router.get('/relatorio', controller.relatorio);

router.get('/avulsos', controller.listarAvulsos);
router.post('/avulsos', controller.registrarAvulso);

router.get('/substituicoes/previa', controller.previaSubstituicao);
router.post('/substituicoes', controller.substituirInsumo);

router.get('/vendas/:vendaId', controller.linhasDaVenda);
router.post('/vendas/:vendaId/linhas', controller.acrescentarNaVenda);
router.patch('/vendas/:vendaId/linhas/:consumoId/retirar', controller.retirarLinha);
router.patch('/vendas/:vendaId/linhas/:consumoId/regularizar', controller.regularizarLinha);

module.exports = router;
