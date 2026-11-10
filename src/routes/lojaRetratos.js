const express = require('express');
const controller = require('../controllers/lojaRetratosController');
const uploadRetrato = require('../middlewares/uploadRetrato');

const router = express.Router();

// Retratos da abertura da Home. Autenticação, papel (admin) e funcionalidade `loja_online` são exigidos em app.js.
router.get('/', controller.listar);
router.post('/', uploadRetrato, controller.criar);
router.patch('/:id', controller.atualizar);
router.delete('/:id', controller.remover);

module.exports = router;
