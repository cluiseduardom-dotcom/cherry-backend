const express = require('express');
const router = express.Router();
const requireCapacidade = require('../middlewares/requireCapacidade');
const { CAPACIDADES } = require('../constants/cargos');
const controller = require('../controllers/dashboardController');

router.get('/', controller.resumo);
router.get('/curva-abc', controller.curvaABC);
router.get('/giro', controller.giro);
router.get('/cobertura', controller.cobertura);
// Margem é dado de custo: só com `ver_custos` (ver_dashboard sozinho não basta).
router.get('/margem', requireCapacidade(CAPACIDADES.VER_CUSTOS), controller.margem);
router.get('/giro-cobertura', controller.giroCoberturaAgregado);

module.exports = router;
