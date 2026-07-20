const express = require('express');
const router = express.Router();
const controller = require('../controllers/produtosController');
const requireAdmin = require('../middlewares/requireAdmin');

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

router.get('/:id', controller.buscarPorId);
router.put('/:id', requireAdmin, controller.atualizar);
router.delete('/:id', requireAdmin, controller.remover);

module.exports = router;