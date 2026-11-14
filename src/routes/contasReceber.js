const express = require('express');
const router = express.Router();
const controller = require('../controllers/contasReceberController');

router.get('/', controller.listar);

router.get('/:id', controller.buscarPorId);
router.get('/:id/recebimentos', controller.listarRecebimentos);
// Recebimento total ou parcial (corpo { valor?, forma_pagamento?, observacao? } + Idempotency-Key). Sem `valor` = o restante.
router.post('/:id/recebimentos', controller.receber);
// Receber o restante de uma vez (mantido por compatibilidade; para conta com parcela, registra o recebimento da parcela).
router.patch('/:id/receber', controller.marcarComoRecebida);

module.exports = router;
