const express = require('express');

const router = express.Router();

const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const requireAdmin = require('../middlewares/requireAdmin');

router.post('/login', authController.login);
router.post('/register', authMiddleware, requireAdmin, authController.register);

module.exports = router;