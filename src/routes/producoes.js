const express = require('express');
const router = express.Router();
const controller = require('../controllers/producoesController');
const ordens = require('../controllers/ordensProducaoController');

const exigirFuncionalidade = require('../middlewares/exigirFuncionalidade');

// Necessidade de material (somente leitura): módulo PCP, só com a funcionalidade `pcp` ligada. As rotas abaixo
// (listar, criar, buscar, cancelar) continuam abertas como sempre foram, para não tirar nada de quem já usa.
// Vem antes de '/:id' para não ser lida como id.
router.get('/necessidade', exigirFuncionalidade('pcp'), controller.necessidade);

// Ordens de produção (planejada → em produção → concluída/cancelada): tudo sob a funcionalidade `pcp`.
router.use('/ordens', exigirFuncionalidade('pcp'));
router.post('/ordens', ordens.criar);
router.get('/ordens', ordens.listar);
router.get('/ordens/:id', ordens.buscarPorId);
router.patch('/ordens/:id/iniciar', ordens.iniciar);
router.patch('/ordens/:id/concluir', ordens.concluir);
router.patch('/ordens/:id/regularizar-insumos', ordens.regularizarInsumos);
router.patch('/ordens/:id/cancelar', ordens.cancelar);

router.get('/', controller.listar);
router.post('/', controller.criar);
router.get('/:id', controller.buscarPorId);
router.patch('/:id/cancelar', controller.cancelar);

module.exports = router;
