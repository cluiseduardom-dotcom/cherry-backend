const express = require('express');
const controller = require('../controllers/fiadoController');
const requireAdmin = require('../middlewares/requireAdmin');

const router = express.Router();

// Fiado. Autenticação, papel mínimo (vendedor) e funcionalidade `fiado` são exigidos em app.js.
router.get('/resumo', controller.resumo);
router.get('/clientes', controller.clientes);
router.get('/clientes/:id/extrato', controller.extrato);
router.get('/clientes/:id/cobranca', controller.cobranca);
router.post('/clientes/:id/compras', controller.compra);
router.post('/clientes/:id/pagamentos', controller.pagamento);
// Corrigir é estornar, e só o admin estorna.
router.post('/lancamentos/:id/estorno', requireAdmin, controller.estorno);

module.exports = router;
