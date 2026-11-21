const express = require('express');
const router = express.Router();
const controller = require('../controllers/gradesController');
const requireAdmin = require('../middlewares/requireAdmin');
const requireEstoquista = require('../middlewares/requireEstoquista');

// Grade de produtos (variações de tamanho, cor...). O app.js exige a funcionalidade `grade`.
// Ler: admin e estoquista (custo só com permissão). Criar e alterar: só admin, como o cadastro de produto.
router.get('/', requireEstoquista, controller.listar);
router.get('/:id', requireEstoquista, controller.buscarPorId);
router.post('/', requireAdmin, controller.criar);
router.post('/:id/variacoes', requireAdmin, controller.acrescentar);
router.patch('/:id', requireAdmin, controller.atualizar);

module.exports = router;
