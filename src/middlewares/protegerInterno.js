const crypto = require('node:crypto');

const TAMANHO_MINIMO_SEGREDO = 24;

function registrarAuditoria(evento, req, detalhes = {}) {
    // Nunca registrar o cabeçalho de credencial, o corpo da requisição ou o segredo.
    const linha = JSON.stringify({
        evento,
        caminho: typeof req.baseUrl === 'string' ? req.baseUrl : '/interno',
        metodo: req.method,
        ip: typeof req.ip === 'string' ? req.ip : 'indisponivel',
        timestamp: new Date().toISOString(),
        ...detalhes
    });

    if (evento === 'interno_credencial_aceita') {
        console.info(linha);
        return;
    }

    console.warn(linha);
}

function resumo(valor) {
    return crypto.createHash('sha256').update(valor, 'utf8').digest();
}

// Painel interno da GiroOne (ADR-007, D13 opção A): só quem tem o segredo do servidor opera.
// Falha fechada em TODOS os ambientes (sem atalho para dev/test): segredo ausente, curto ou
// igual ao do onboarding deixa as rotas indisponíveis (503). O segredo é próprio, não é o
// ONBOARDING_SECRET.
function protegerInterno(req, res, next) {
    const segredo = typeof process.env.INTERNO_SECRET === 'string' ? process.env.INTERNO_SECRET.trim() : '';
    const onboarding = typeof process.env.ONBOARDING_SECRET === 'string' ? process.env.ONBOARDING_SECRET.trim() : '';

    if (segredo.length < TAMANHO_MINIMO_SEGREDO || (onboarding && segredo === onboarding)) {
        registrarAuditoria('interno_indisponivel', req, { motivo: 'segredo_nao_configurado_ou_invalido' });
        return res.status(503).json({ success: false, message: 'Painel interno indisponível' });
    }

    const recebido = req.get('X-Interno-Secret');

    if (typeof recebido !== 'string') {
        registrarAuditoria('interno_credencial_rejeitada', req, { motivo: 'cabecalho_ausente' });
        return res.status(401).json({ success: false, message: 'Não autorizado' });
    }

    // Compara os resumos (tamanho fixo): não vaza o comprimento do segredo.
    if (!crypto.timingSafeEqual(resumo(segredo), resumo(recebido.trim()))) {
        registrarAuditoria('interno_credencial_rejeitada', req, { motivo: 'credencial_invalida' });
        return res.status(401).json({ success: false, message: 'Não autorizado' });
    }

    registrarAuditoria('interno_credencial_aceita', req);
    return next();
}

module.exports = protegerInterno;
module.exports.TAMANHO_MINIMO_SEGREDO = TAMANHO_MINIMO_SEGREDO;
