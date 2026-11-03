const express = require('express');
const router = express.Router();
const bancos = require('../controllers/bancosController');

// Mount: /bancos com authMiddleware + requireCapacidade(gerir_financeiro).
router.get('/contas', bancos.listarContas);
router.post('/contas', bancos.criarConta);
router.get('/contas/:id', bancos.buscarConta);
router.patch('/contas/:id', bancos.atualizarConta);
router.patch('/contas/:id/status', bancos.statusConta);

router.get('/movimentos', bancos.listarMovimentos);
router.post('/movimentos', bancos.lancarMovimento);
router.post('/movimentos/:id/cancelar', bancos.cancelarMovimento);

router.get('/conciliacoes', bancos.listarConciliacoes);
router.post('/conciliacoes', bancos.conciliar);
router.post('/conciliacoes/:id/desfazer', bancos.desfazerConciliacao);

module.exports = router;
