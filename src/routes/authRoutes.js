const express = require('express');

const router = express.Router();

const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const requireAdmin = require('../middlewares/requireAdmin');
const loginRateLimiter = require('../middlewares/loginRateLimiter');
const uploadImagemProduto = require('../middlewares/uploadImagemProduto');
const fotosController = require('../controllers/usuarioFotosController');
const confirmacaoSenhaRateLimiter = require('../middlewares/confirmacaoSenhaRateLimiter');

router.post('/login', loginRateLimiter, authController.login);
router.get('/me', authMiddleware, authController.me);
// Renova o token da PRÓPRIA sessão (id e empresa vêm do JWT; sem corpo). Respeita o teto de 8 h desde o login.
router.post('/renovar', authMiddleware, authController.renovar);
// Qualquer usuário autenticado troca a PRÓPRIA senha (empresa e id vêm do JWT, nunca do body).
router.post('/senha', authMiddleware, confirmacaoSenhaRateLimiter, authController.alterarSenha);
// Qualquer usuário autenticado troca/remove a PRÓPRIA foto (alvo = id do JWT, nunca do body/URL).
router.put('/foto', authMiddleware, uploadImagemProduto, fotosController.definir);
router.delete('/foto', authMiddleware, fotosController.remover);
router.post('/register', authMiddleware, requireAdmin, authController.register);

module.exports = router;