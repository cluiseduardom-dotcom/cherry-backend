const express = require('express');
const router = express.Router();
const pontoEquilibrioController = require('../controllers/pontoEquilibrioController');

router.get('/ponto-equilibrio', pontoEquilibrioController.calcular);

module.exports = router;
