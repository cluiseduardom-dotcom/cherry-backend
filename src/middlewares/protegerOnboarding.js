const crypto = require('node:crypto');

function registrarAuditoriaOnboarding(evento, req, detalhes = {}) {
    // Nunca registrar o cabeçalho de credencial, corpo da requisição,
    // senha, token ou qualquer dado de provisionamento.
    const registro = {
        evento,
        ambiente: process.env.NODE_ENV || 'indefinido',
        caminho: '/onboarding',
        metodo: req.method || 'POST',
        ip: typeof req.ip === 'string' ? req.ip : 'indisponivel',
        timestamp: new Date().toISOString(),
        ...detalhes,
    };

    const linha = JSON.stringify(registro);
    if (evento === 'onboarding_credencial_rejeitada' || evento === 'onboarding_indisponivel') {
        console.warn(linha);
        return;
    }

    console.info(linha);
}

/**
 * Tenant creation is privileged. Only explicit local development/test
 * environments may bypass the server-side onboarding secret.
 * Missing NODE_ENV is treated as non-local and fails closed.
 */
function protegerOnboarding(req, res, next) {
    const ambiente = process.env.NODE_ENV;
    const secretConfigurado = process.env.ONBOARDING_SECRET;

    if (ambiente === 'development' || ambiente === 'test') {
        return next();
    }

    if (!secretConfigurado || !secretConfigurado.trim()) {
        registrarAuditoriaOnboarding('onboarding_indisponivel', req, {
            motivo: 'segredo_nao_configurado',
        });
        return res.status(503).json({
            erro: 'Provisionamento temporariamente indisponível'
        });
    }

    const recebido = req.get('X-Onboarding-Secret');

    if (typeof recebido !== 'string') {
        registrarAuditoriaOnboarding('onboarding_credencial_rejeitada', req, {
            motivo: 'cabecalho_ausente',
        });
        return res.status(401).json({ erro: 'Não autorizado' });
    }

    const esperadoBuffer = Buffer.from(secretConfigurado, 'utf8');
    const recebidoBuffer = Buffer.from(recebido, 'utf8');

    if (
        esperadoBuffer.length !== recebidoBuffer.length ||
        !crypto.timingSafeEqual(esperadoBuffer, recebidoBuffer)
    ) {
        registrarAuditoriaOnboarding('onboarding_credencial_rejeitada', req, {
            motivo: 'credencial_invalida',
        });
        return res.status(401).json({ erro: 'Não autorizado' });
    }

    registrarAuditoriaOnboarding('onboarding_credencial_aceita', req);
    return next();
}

module.exports = protegerOnboarding;
