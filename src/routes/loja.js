const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/lojaController');

const router = express.Router();

// Rotas SEM autenticação: catálogo (GET) e pedido do visitante (POST cria, GET acompanha pelo código). A empresa é resolvida no backend pelo slug público; só responde
// para empresa ativa com a funcionalidade `loja_online` ligada. Teto por IP.
const LIMITE_POR_MINUTO = process.env.NODE_ENV === 'test' ? 10000 : 120;

const limiteLoja = rateLimit({
    windowMs: 60 * 1000,
    limit: LIMITE_POR_MINUTO,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => rateLimit.ipKeyGenerator(req.ip),
    handler: (req, res) => res.status(429).json({ success: false, message: 'Muitas requisições. Tente novamente em instantes.' })
});

// Criar pedido reserva estoque: teto bem menor por IP (freio contra reserva em massa).
const limitePedido = rateLimit({
    windowMs: 60 * 1000,
    limit: process.env.NODE_ENV === 'test' ? 10000 : 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => rateLimit.ipKeyGenerator(req.ip),
    handler: (req, res) => res.status(429).json({ success: false, message: 'Muitos pedidos em pouco tempo. Tente novamente em instantes.' })
});

router.get('/:slug/catalogo', limiteLoja, controller.catalogo);
router.get('/:slug/categorias', limiteLoja, controller.categorias);
router.get('/:slug/menu', limiteLoja, controller.menu);
router.get('/:slug/vitrines', limiteLoja, controller.vitrines);
router.get('/:slug/retratos', limiteLoja, controller.retratos);
router.get('/:slug/institucional', limiteLoja, controller.institucional);
router.get('/:slug/produtos/:produtoSlug', limiteLoja, controller.produto);
router.post('/:slug/pedidos', limitePedido, controller.criarPedido);
router.get('/:slug/pedidos/:codigo', limiteLoja, controller.buscarPedido);
// Cria (ou devolve) o Pix/link de cartão do pedido. Mesmo teto do pedido: cada chamada pode ir ao Mercado Pago.
router.post('/:slug/pedidos/:codigo/pagamento', limitePedido, controller.criarPagamento);

module.exports = router;
