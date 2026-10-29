const express = require('express');
const router = express.Router();
const controller = require('../controllers/mercadoPagoController');
const requireCapacidade = require('../middlewares/requireCapacidade');
const { CAPACIDADES } = require('../constants/cargos');

// O mount (app.js) já é authMiddleware + requireVendedor (admin e vendedor). Empresa sempre do JWT.
router.get('/disponibilidade', controller.disponibilidade);
router.post('/pix', controller.criarPix);

// Devolução de Pix (dinheiro saindo): só quem tem `gerir_financeiro` (Admin tem todas).
// Declaradas antes de '/:codigo' para não serem lidas como código de cobrança.
router.get('/a-devolver', requireCapacidade(CAPACIDADES.GERIR_FINANCEIRO), controller.pixADevolver);
router.get('/devolucoes', requireCapacidade(CAPACIDADES.GERIR_FINANCEIRO), controller.devolucoes);
router.post('/:codigo/devolucao', requireCapacidade(CAPACIDADES.GERIR_FINANCEIRO), controller.devolverPix);

router.get('/:codigo', controller.consultarCobranca);

module.exports = router;
