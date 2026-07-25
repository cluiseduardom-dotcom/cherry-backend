const express = require('express');
const router = express.Router();
const controller = require('../controllers/vendasController');
const requireAdmin = require('../middlewares/requireAdmin');
const requireVendedor = require('../middlewares/requireVendedor');

router.get('/resumo', controller.resumo);
router.get('/por-dia', controller.porDia);
router.get('/por-mes', controller.porMes);
router.get('/mais-vendidos', controller.maisVendidos);

router.get('/', requireVendedor, controller.listar);
router.post('/', requireVendedor, controller.criar);

router.get('/:id', requireVendedor, controller.buscarPorId);
router.patch('/:id/cancelar', requireAdmin, controller.cancelar);

module.exports = router;
