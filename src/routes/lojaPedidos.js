const express = require('express');
const controller = require('../controllers/lojaGestaoController');

const router = express.Router();

// Pedidos da loja online para a EQUIPE. A autenticação, o papel (admin ou vendedor) e a funcionalidade `loja_online`
// são exigidos em app.js. Traz dado pessoal da cliente, por isso nunca é público.
router.get('/', controller.listar);
router.post('/:codigo/entrega-combinada', controller.marcarEntregaCombinada);

module.exports = router;
