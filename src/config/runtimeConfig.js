const AMBIENTES_VALIDOS = new Set(['development', 'test', 'production']);

function validarRuntime(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';

    if (!AMBIENTES_VALIDOS.has(nodeEnv)) {
        throw new Error(`NODE_ENV inválido: ${nodeEnv}`);
    }

    if (!env.DATABASE_URL) {
        throw new Error('DATABASE_URL não configurada');
    }

    if (!env.JWT_SECRET) {
        throw new Error('JWT_SECRET não configurado');
    }

    if (nodeEnv === 'production') {
        if (env.JWT_SECRET.length < 32) {
            throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres em produção');
        }

        if (!env.CORS_ORIGINS || !env.CORS_ORIGINS.trim()) {
            throw new Error('CORS_ORIGINS deve ser configurado em produção');
        }
    }

    return {
        nodeEnv,
        databaseUrlConfigured: true,
        corsOriginsConfigured: Boolean(env.CORS_ORIGINS && env.CORS_ORIGINS.trim())
    };
}

module.exports = { validarRuntime };
