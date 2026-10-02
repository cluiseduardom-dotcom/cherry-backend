const express = require('express');
const router = express.Router();
const controller = require('../controllers/pagamentosController');
const requireVendedor = require('../middlewares/requireVendedor');
const requireAdmin = require('../middlewares/requireAdmin');

router.get('/:id', requireVendedor, controller.buscar);
router.post('/:id/estornar', requireAdmin, controller.estornar);

module.exports = router;
