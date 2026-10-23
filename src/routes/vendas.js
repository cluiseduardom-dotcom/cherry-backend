const express = require('express');
const router = express.Router();
const controller = require('../controllers/vendasController');
const requireCapacidade = require('../middlewares/requireCapacidade');
const autorizacaoCancelamentoRateLimiter = require('../middlewares/autorizacaoCancelamentoRateLimiter');
const { CAPACIDADES } = require('../constants/cargos');
const requireVendedor = require('../middlewares/requireVendedor');

router.get('/resumo', requireVendedor, controller.resumo);
router.get('/por-dia', requireVendedor, controller.porDia);
router.get('/por-mes', requireVendedor, controller.porMes);
router.get('/mais-vendidos', requireVendedor, controller.maisVendidos);

router.get('/', requireVendedor, controller.listar);
router.post('/', requireVendedor, controller.criar);

router.get('/:id', requireVendedor, controller.buscarPorId);

// Cancelar exige a capacidade `cancelar_venda` (Admin tem todas). O motivo é obrigatório e a
// faixa de idade da venda decide se pede a senha de um autorizador (cancelamentosService).
router.get('/:id/cancelamento/previa', requireCapacidade(CAPACIDADES.CANCELAR_VENDA), controller.previaCancelamento);
router.patch('/:id/cancelar', requireCapacidade(CAPACIDADES.CANCELAR_VENDA), autorizacaoCancelamentoRateLimiter, controller.cancelar);

module.exports = router;
