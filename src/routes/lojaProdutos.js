const express = require('express');
const controller = require('../controllers/lojaGestaoController');

const router = express.Router();

// Lista dos produtos para a marcação "mostrar na loja". Autenticação, papel (admin) e funcionalidade `loja_online`
// são exigidos em app.js. A marcação em si continua em GET/PUT /produtos/:id/loja.
router.get('/', controller.listarProdutos);
// Copia descrição e material do cadastro para as peças marcadas que ainda estão sem esse texto (nunca troca texto escrito).
router.post('/preencher-do-cadastro', controller.preencherTextosDoCadastro);

module.exports = router;
