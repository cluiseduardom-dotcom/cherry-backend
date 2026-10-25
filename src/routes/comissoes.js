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

// Dinheiro recebido pelo vendedor: o vendedor vê os seus; quem tem `ver_vendas_de_todos` vê os
// da empresa e é quem CONFIRMA o repasse (o próprio vendedor nunca confirma o seu).
router.get('/repasses', requireVendedor, controller.repasses);
router.post('/repasses/:id/confirmar', requireCapacidade(CAPACIDADES.VER_VENDAS_DE_TODOS), controller.confirmarRepasse);

// Pagamento da comissão AO vendedor (a empresa pagando). Só admin vê o que há a pagar e registra o
// pagamento (nunca o da própria comissão); o histórico é do admin/gerente (todos) ou do vendedor (só o seu).
router.get('/a-pagar', requireAdmin, controller.aPagar);
router.post('/pagamentos', requireAdmin, controller.registrarPagamento);
router.get('/pagamentos', requireVendedor, controller.pagamentos);

// Histórico de uma comissão: o dono vê a sua; gerente/admin vê qualquer uma da empresa.
router.get('/:id/historico', requireVendedor, controller.historico);

// Regra de dinheiro: só o admin vê e altera os percentuais.
router.get('/percentuais', requireAdmin, controller.listarPercentuais);
router.put('/percentuais', requireAdmin, controller.definirPercentual);

module.exports = router;
