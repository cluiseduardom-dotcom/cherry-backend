const express = require('express');
const router = express.Router();
const controller = require('../controllers/comissoesController');
const requireAdmin = require('../middlewares/requireAdmin');
const requireVendedor = require('../middlewares/requireVendedor');
const requireCapacidade = require('../middlewares/requireCapacidade');
const { CAPACIDADES } = require('../constants/cargos');

// O mount /comissoes já é authMiddleware; cada rota declara o seu nível.

// Vendedor (e admin): só as PRÓPRIAS comissões, pelo usuário do JWT.
router.get('/minhas', requireVendedor, controller.minhas);

// Gerente/admin: quem tem `ver_vendas_de_todos` (Admin tem todas) vê a equipe inteira.
router.get('/equipe', requireCapacidade(CAPACIDADES.VER_VENDAS_DE_TODOS), controller.equipe);

// Regra de dinheiro: só o admin vê e altera os percentuais.
router.get('/percentuais', requireAdmin, controller.listarPercentuais);
router.put('/percentuais', requireAdmin, controller.definirPercentual);

module.exports = router;
