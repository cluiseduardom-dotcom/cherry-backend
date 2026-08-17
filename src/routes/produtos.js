const express = require('express');
const router = express.Router();
const controller = require('../controllers/produtosController');
const estoqueController = require('../controllers/estoqueController');
const precosController = require('../controllers/precosController');
const requireAdmin = require('../middlewares/requireAdmin');
const requireEstoquista = require('../middlewares/requireEstoquista');

router.get('/', controller.listar);
router.post('/', requireAdmin, controller.criar);
router.get('/mais-vendidos', controller.maisVendidos);
router.get('/curva-abc', controller.curvaABC);
router.get('/reposicao', controller.reposicao);
router.get('/sugestao-preco', controller.sugestaoPreco);
router.get('/giro', controller.giro);
router.get('/parados', controller.parados);
router.get('/pricing', controller.pricingProfissional);
router.get('/pricing-profissional', controller.pricingProfissional);
router.get('/lucro', controller.lucroPorProduto);
router.get('/alerta-prejuizo', controller.alertaPrejuizo);
router.get('/inteligencia', controller.inteligencia);
router.get('/dashboard', controller.dashboard);
router.get('/estoque-baixo', estoqueController.alertas);

router.get('/:id', controller.buscarPorId);
router.put('/:id', requireAdmin, controller.atualizar);
router.delete('/:id', requireAdmin, controller.remover);

router.get('/:id/movimentacoes', estoqueController.historico);
router.post('/:id/movimentacoes', requireEstoquista, estoqueController.registrarMovimentacao);

router.get('/:id/precos', precosController.listarVigentes);
router.get('/:id/precos/historico', requireAdmin, precosController.historico);
router.put('/:id/precos/:canalId', requireAdmin, precosController.definirPreco);

module.exports = router;