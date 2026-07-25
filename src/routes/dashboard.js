const express = require('express');
const router = express.Router();
const controller = require('../controllers/dashboardController');

router.get('/', controller.resumo);
router.get('/curva-abc', controller.curvaABC);
router.get('/giro', controller.giro);
router.get('/cobertura', controller.cobertura);
router.get('/margem', controller.margem);

module.exports = router;
