const express = require('express');
const router = express.Router();
const controller = require('../controllers/parcelasPagamentoController');
const requireAdmin = require('../middlewares/requireAdmin');

router.patch('/:id/receber', requireAdmin, controller.receber);

module.exports = router;
