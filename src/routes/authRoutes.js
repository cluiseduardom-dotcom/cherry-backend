const express = require('express');

const router = express.Router();

const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const requireAdmin = require('../middlewares/requireAdmin');
const loginRateLimiter = require('../middlewares/loginRateLimiter');

router.post('/login', loginRateLimiter, authController.login);
router.post('/register', authMiddleware, requireAdmin, authController.register);

module.exports = router;