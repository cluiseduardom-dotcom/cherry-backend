const crypto = require('node:crypto');

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
        return res.status(503).json({
            erro: 'Provisionamento temporariamente indisponível'
        });
    }

    const recebido = req.get('X-Onboarding-Secret');

    if (typeof recebido !== 'string') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }

    const esperadoBuffer = Buffer.from(secretConfigurado, 'utf8');
    const recebidoBuffer = Buffer.from(recebido, 'utf8');

    if (
        esperadoBuffer.length !== recebidoBuffer.length ||
        !crypto.timingSafeEqual(esperadoBuffer, recebidoBuffer)
    ) {
        return res.status(401).json({ erro: 'Não autorizado' });
    }

    return next();
}

module.exports = protegerOnboarding;
