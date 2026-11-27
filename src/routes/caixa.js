const express = require('express');
const controller = require('../controllers/caixaController');
const requireCapacidade = require('../middlewares/requireCapacidade');
const { CAPACIDADES } = require('../constants/cargos');

const router = express.Router();

// Caixa por PDV. Autenticação, funcionalidade `caixa` e (operar_caixa OU gerir_caixas) são exigidos em app.js.
// Cadastrar/desativar caixas é só de quem gere; abrir é de quem opera (verificado no controller, pois gerir NÃO implica operar).
router.get('/caixas', controller.listarCaixas);
router.post('/caixas', requireCapacidade(CAPACIDADES.GERIR_CAIXAS), controller.criarCaixa);
router.patch('/caixas/:id', requireCapacidade(CAPACIDADES.GERIR_CAIXAS), controller.atualizarCaixa);

router.get('/sessao-atual', controller.sessaoAtual);
router.get('/sessoes', controller.listarSessoes);
router.post('/sessoes', controller.abrirSessao);
router.get('/sessoes/:id', controller.detalharSessao);
router.post('/sessoes/:id/movimentos', controller.lancarMovimento);
router.post('/sessoes/:id/fechamento', controller.fecharSessao);

module.exports = router;
