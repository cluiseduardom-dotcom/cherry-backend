const express = require('express');
const router = express.Router();
const controller = require('../controllers/relatoriosController');
const requireCapacidade = require('../middlewares/requireCapacidade');
const requireEstoquista = require('../middlewares/requireEstoquista');
const { CAPACIDADES } = require('../constants/cargos');

// Relatórios de gestão: somente leitura, sempre da empresa do JWT. Vendas, desempenho e produtos cobrem a
// empresa toda, então exigem `ver_vendas_de_todos` (como o resultado do período). Custo, lucro e margem
// só saem para quem tem `ver_custos` (omitidos para os demais; ver relatoriosService).
const verVendasDeTodos = requireCapacidade(CAPACIDADES.VER_VENDAS_DE_TODOS);

router.get('/vendas', verVendasDeTodos, controller.vendas);
router.get('/desempenho', verVendasDeTodos, controller.desempenho);
router.get('/produtos', verVendasDeTodos, controller.produtos);

// Inventário: admin e estoquista (mesmo alcance do estoque); o valor do estoque segue a regra de custo operacional.
router.get('/inventario', requireEstoquista, controller.inventario);

// Crédito (recebíveis e fiado): financeiro, e só quem enxerga todos os clientes (nomes de devedores).
router.get(
    '/credito',
    requireCapacidade(CAPACIDADES.GERIR_FINANCEIRO),
    requireCapacidade(CAPACIDADES.VER_TODOS_CLIENTES),
    controller.credito
);

module.exports = router;
