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

router.post('/mercadopago/sincronizar', bancos.sincronizarMercadoPago);

// Extrato (OFX/CSV) vai no corpo JSON como texto; só aqui o limite é maior, e só depois da autenticação
// (o parser padrão do app pula este caminho).
router.post('/importacoes/previa', express.json({ limit: '4mb' }), bancos.previaExtrato);
router.post('/importacoes', express.json({ limit: '4mb' }), bancos.importarExtrato);
router.get('/movimentos/:id/sugestoes', bancos.sugestoesMovimento);

module.exports = router;
