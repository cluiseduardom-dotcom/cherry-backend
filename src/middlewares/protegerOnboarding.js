const crypto = require('node:crypto');

/**
 * Protects tenant creation from unauthenticated public requests.
 * In staging/production, the endpoint is unavailable until ONBOARDING_SECRET
 * is configured in the backend environment. When configured, callers must
 * send the same value in the X-Onboarding-Secret header.
 *
 * Local development/test environments remain usable without the secret.
 */
function protegerOnboarding(req, res, next) {
    const ambiente = process.env.NODE_ENV || 'development';
    const secretConfigurado = process.env.ONBOARDING_SECRET;

    if (ambiente !== 'production' && ambiente !== 'staging') {
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
