const express = require('express');
const router = express.Router();
const controller = require('../controllers/vendasController');
const requireAdmin = require('../middlewares/requireAdmin');
const requireVendedor = require('../middlewares/requireVendedor');

router.get('/resumo', requireAdmin, controller.resumo);
router.get('/por-dia', requireAdmin, controller.porDia);
router.get('/por-mes', requireAdmin, controller.porMes);
router.get('/mais-vendidos', requireAdmin, controller.maisVendidos);

router.get('/', requireVendedor, controller.listar);
router.post('/', requireVendedor, controller.criar);

router.get('/:id', requireVendedor, controller.buscarPorId);
router.patch('/:id/cancelar', requireAdmin, controller.cancelar);

module.exports = router;
