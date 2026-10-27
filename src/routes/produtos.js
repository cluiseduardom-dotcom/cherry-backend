const express = require('express');
const router = express.Router();
const controller = require('../controllers/produtosController');
const estoqueController = require('../controllers/estoqueController');
const precosController = require('../controllers/precosController');
const fichasTecnicasController = require('../controllers/fichasTecnicasController');
const fichasVendaController = require('../controllers/fichasVendaController');
const produtosCodigosController = require('../controllers/produtosCodigosController');
const produtoImagensController = require('../controllers/produtoImagensController');
const uploadImagemProduto = require('../middlewares/uploadImagemProduto');
const requireAdmin = require('../middlewares/requireAdmin');
const requireEstoquista = require('../middlewares/requireEstoquista');

router.get('/', controller.listar);
router.get('/buscar-codigo/:codigo', produtosCodigosController.buscar);
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
router.get('/movimentacoes', requireAdmin, estoqueController.listarMovimentacoesRelatorio);
router.get('/locais-estoque', requireEstoquista, estoqueController.listarLocais);

router.get('/:id', controller.buscarPorId);
router.put('/:id', requireAdmin, controller.atualizar);
router.delete('/:id', requireAdmin, controller.remover);
router.patch('/:id/categoria', requireEstoquista, controller.categorizar);
router.get('/:id/codigos', produtosCodigosController.listar);
router.post('/:id/codigos', requireEstoquista, produtosCodigosController.adicionar);
router.delete('/:id/codigos/:codigoId', requireEstoquista, produtosCodigosController.remover);

// Fotos do produto: ler é de qualquer usuário autenticado; enviar, apagar e reordenar é de admin/estoquista.
router.get('/:id/imagens', produtoImagensController.listar);
router.post('/:id/imagens', requireEstoquista, uploadImagemProduto, produtoImagensController.adicionar);
router.put('/:id/imagens/ordem', requireEstoquista, produtoImagensController.reordenar);
router.delete('/:id/imagens/:imagemId', requireEstoquista, produtoImagensController.remover);

router.get('/:id/movimentacoes', estoqueController.historico);
router.post('/:id/movimentacoes', requireEstoquista, estoqueController.registrarMovimentacao);
router.get('/:id/estoque-locais', requireEstoquista, estoqueController.saldosPorLocal);

router.get('/:id/precos', precosController.listarVigentes);
router.get('/:id/precos/historico', requireAdmin, precosController.historico);
router.put('/:id/precos/:canalId', requireAdmin, precosController.definirPreco);

router.post('/:id/ficha-tecnica', requireEstoquista, fichasTecnicasController.criar);
router.get('/:id/ficha-tecnica', requireEstoquista, fichasTecnicasController.buscarVigente);
router.get('/:id/ficha-tecnica/historico', requireAdmin, fichasTecnicasController.historico);

// Ficha de venda do SKU (o que sai do estoque a cada unidade vendida): admin e estoquista.
router.post('/:id/ficha-venda', requireEstoquista, fichasVendaController.criar);
router.get('/:id/ficha-venda', requireEstoquista, fichasVendaController.buscarVigente);
router.get('/:id/ficha-venda/historico', requireEstoquista, fichasVendaController.historico);

module.exports = router;