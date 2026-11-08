const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/lojaController');

const router = express.Router();

// Rotas SEM autenticação, somente leitura (GET). A empresa é resolvida no backend pelo slug público; só responde
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

router.get('/:slug/catalogo', limiteLoja, controller.catalogo);
router.get('/:slug/categorias', limiteLoja, controller.categorias);
router.get('/:slug/vitrines', limiteLoja, controller.vitrines);
router.get('/:slug/produtos/:produtoSlug', limiteLoja, controller.produto);

module.exports = router;
