const express = require('express');

const router = express.Router();

const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const requireAdmin = require('../middlewares/requireAdmin');
const loginRateLimiter = require('../middlewares/loginRateLimiter');
const confirmacaoSenhaRateLimiter = require('../middlewares/confirmacaoSenhaRateLimiter');

router.post('/login', loginRateLimiter, authController.login);
router.get('/me', authMiddleware, authController.me);
// Qualquer usuário autenticado troca a PRÓPRIA senha (empresa e id vêm do JWT, nunca do body).
router.post('/senha', authMiddleware, confirmacaoSenhaRateLimiter, authController.alterarSenha);
router.post('/register', authMiddleware, requireAdmin, authController.register);

module.exports = router;