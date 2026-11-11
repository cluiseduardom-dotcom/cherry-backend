const express = require('express');
const controller = require('../controllers/lojaBannersController');
const uploadRetrato = require('../middlewares/uploadRetrato');

const router = express.Router();

// Faixas rotativas da Home. Autenticação, papel (admin) e funcionalidade `loja_online` são exigidos em app.js.
router.get('/', controller.listar);
router.post('/', controller.criar);
router.patch('/:id', controller.atualizar);
router.delete('/:id', controller.remover);
router.put('/:id/imagem/:lado', uploadRetrato, controller.enviarImagem);
router.delete('/:id/imagem/:lado', controller.removerImagem);

module.exports = router;
