const express = require('express');
const router = express.Router();
const controller = require('../controllers/cancelamentosController');

// O mount (app.js) já é authMiddleware + requireCapacidade('ver_cancelamentos').
router.get('/', controller.listar);

module.exports = router;
