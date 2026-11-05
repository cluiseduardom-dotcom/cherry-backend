const express = require('express');
const router = express.Router();
const painel = require('../controllers/painelController');
const plataforma = require('../controllers/plataformaController');
const comercial = require('../controllers/plataformaComercialController');
const identidade = require('../controllers/plataformaIdentidadeController');
const funcionalidades = require('../controllers/funcionalidadesPainelController');
const requirePainel = require('../middlewares/requirePainel');
const registrar = require('../middlewares/registrarEventoPainel');
const { criarLoginRateLimiter, criarLimiterPorIp } = require('../middlewares/loginRateLimiter');

// Painel GiroNex: operadores da plataforma, com sessão e segredos próprios (nunca o login das lojas).
// As ações de plataforma reaproveitam os mesmos controllers/serviços de /plataforma; aqui muda só quem
// pode chamar (req.operador) e quem assina (req.responsavelPlataforma), e cada mudança vai para a trilha.

const emTeste = process.env.NODE_ENV === 'test';
const limiteLogin = [
    criarLimiterPorIp({ limit: emTeste ? 1000 : 20 }),
    criarLoginRateLimiter({ limit: emTeste ? 1000 : 5 })
];

router.post('/auth/login', limiteLogin, painel.login);
router.post('/auth/2fa/iniciar', limiteLogin, painel.iniciar2fa);
router.post('/auth/2fa/confirmar', limiteLogin, painel.confirmar2fa);
router.get('/auth/me', requirePainel({ permitirTemporaria: true }), painel.me);
router.post('/auth/renovar', requirePainel({ permitirTemporaria: true }), painel.renovar);
router.post('/auth/senha', requirePainel({ permitirTemporaria: true }), painel.trocarSenha);

const op = requirePainel();

router.get('/taxas', op, plataforma.taxasPorEmpresa);
router.get('/planos', op, comercial.listarPlanos);
router.get('/empresas/comercial', op, comercial.listarEmpresas);
router.get('/empresas/identidade', op, identidade.listar);
router.get('/empresas/:id/comercial/historico', op, comercial.historico);
router.get('/empresas/:id/identidade/historico', op, identidade.historico);
router.post('/empresas', op, painel.criarEmpresa);
router.post('/empresas/:id/plano', op, registrar('plano_trocado'), comercial.trocarPlano);
router.post('/empresas/:id/condicao', op, registrar('condicao_definida'), comercial.definirCondicao);
router.post('/empresas/:id/condicao/encerrar', op, registrar('condicao_encerrada'), comercial.encerrarCondicao);
router.patch('/empresas/:id/identidade', op, registrar('identidade_alterada'), identidade.atualizar);
// Funcionalidades: catálogo + o que cada plano inclui (só leitura; muda por migration) e ligações por empresa.
// A trilha destas mudanças é gravada pelo repository, na mesma transação, com o detalhe (sem registrar()).
router.get('/funcionalidades', op, funcionalidades.catalogo);
router.get('/empresas/:id/funcionalidades', op, funcionalidades.listarDaEmpresa);
router.put('/empresas/:id/funcionalidades/:codigo', op, funcionalidades.definir);
router.delete('/empresas/:id/funcionalidades/:codigo', op, funcionalidades.remover);
router.get('/eventos', op, painel.eventos);

module.exports = router;
