const express = require('express');
const router = express.Router();
const controller = require('../controllers/producoesController');

const exigirFuncionalidade = require('../middlewares/exigirFuncionalidade');

// Necessidade de material (somente leitura): módulo PCP, só com a funcionalidade `pcp` ligada. As rotas abaixo
// (listar, criar, buscar, cancelar) continuam abertas como sempre foram, para não tirar nada de quem já usa.
// Vem antes de '/:id' para não ser lida como id.
router.get('/necessidade', exigirFuncionalidade('pcp'), controller.necessidade);

router.get('/', controller.listar);
router.post('/', controller.criar);
router.get('/:id', controller.buscarPorId);
router.patch('/:id/cancelar', controller.cancelar);

module.exports = router;
