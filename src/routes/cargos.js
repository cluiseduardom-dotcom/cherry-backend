const express = require('express');
const router = express.Router();
const controller = require('../controllers/cargosController');

// O mount (app.js) já é authMiddleware + requireCapacidade('gerir_cargos').
router.get('/', controller.listar);
router.put('/:cargo', controller.atualizar);

module.exports = router;
