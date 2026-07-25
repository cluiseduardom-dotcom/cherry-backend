const express = require('express');
const router = express.Router();
const controller = require('../controllers/precosController');

router.get('/', controller.listarCanais);

module.exports = router;
