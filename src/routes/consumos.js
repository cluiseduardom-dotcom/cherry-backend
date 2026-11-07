const express = require('express');
const router = express.Router();
const controller = require('../controllers/consumosController');

// Montado em /consumos com authMiddleware. Os indicadores (só leitura) também abrem para quem tem
// `ver_dashboard` ou `ver_custos` (Gerente, Analista etc.); todo o resto exige admin ou estoquista. Vendedor = 403.
const requireCapacidade = require('../middlewares/requireCapacidade');
const requireEstoquista = require('../middlewares/requireEstoquista');
const { CAPACIDADES } = require('../constants/cargos');

const permiteIndicadores = (req, res, next) => (
    req.usuario?.role === 'estoquista'
        ? next()
        : requireCapacidade(CAPACIDADES.VER_DASHBOARD, CAPACIDADES.VER_CUSTOS)(req, res, next)
);

router.get('/indicadores', permiteIndicadores, controller.indicadores);

router.use(requireEstoquista);

router.get('/insumos', controller.listarInsumos);
router.get('/relatorio', controller.relatorio);

router.get('/avulsos', controller.listarAvulsos);
router.post('/avulsos', controller.registrarAvulso);

router.get('/substituicoes/previa', controller.previaSubstituicao);
router.post('/substituicoes', controller.substituirInsumo);

router.get('/vendas/:vendaId', controller.linhasDaVenda);
router.post('/vendas/:vendaId/linhas', controller.acrescentarNaVenda);
router.patch('/vendas/:vendaId/linhas/:consumoId/retirar', controller.retirarLinha);
router.patch('/vendas/:vendaId/linhas/:consumoId/regularizar', controller.regularizarLinha);

module.exports = router;
