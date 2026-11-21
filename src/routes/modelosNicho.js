const express = require('express');
const router = express.Router();
const controller = require('../controllers/modelosNichoController');

// Modelos prontos por nicho (categorias e padrão de SKU de partida). Só admin (o app.js monta com requireAdmin).
router.get('/', controller.listar);
router.post('/:id/aplicar', controller.aplicar);

module.exports = router;
