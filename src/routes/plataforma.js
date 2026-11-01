const express = require('express');
const router = express.Router();
const controller = require('../controllers/plataformaController');
const comercial = require('../controllers/plataformaComercialController');
const identidade = require('../controllers/plataformaIdentidadeController');

// O mount (app.js) já é authMiddleware + requirePlataformaAdmin.
router.get('/taxas', controller.taxasPorEmpresa);

// Administração comercial (plano e condição individual por empresa). A empresa-alvo vem da rota:
// exceção deliberada ao empresa_id do JWT, restrita ao operador da plataforma.
router.get('/planos', comercial.listarPlanos);
router.get('/empresas/comercial', comercial.listarEmpresas);
router.get('/empresas/:id/comercial/historico', comercial.historico);
router.post('/empresas/:id/plano', comercial.trocarPlano);
router.post('/empresas/:id/condicao', comercial.definirCondicao);
router.post('/empresas/:id/condicao/encerrar', comercial.encerrarCondicao);

// Identidade por cliente: tema visual e identificador (slug) da URL de login de cada empresa.
router.get('/empresas/identidade', identidade.listar);
router.get('/empresas/:id/identidade/historico', identidade.historico);
router.patch('/empresas/:id/identidade', identidade.atualizar);

module.exports = router;
