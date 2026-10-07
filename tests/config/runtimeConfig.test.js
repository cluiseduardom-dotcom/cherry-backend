const { validarRuntime } = require('../../src/config/runtimeConfig');

describe('validarRuntime', () => {
    test('accepts test environment with required database and JWT', () => {
        expect(validarRuntime({
            NODE_ENV: 'test',
            DATABASE_URL: 'postgresql://test',
            JWT_SECRET: 'test-secret'
        })).toEqual({
            nodeEnv: 'test',
            databaseUrlConfigured: true,
            corsOriginsConfigured: false
        });
    });

    test('rejects missing DATABASE_URL', () => {
        expect(() => validarRuntime({ NODE_ENV: 'test', JWT_SECRET: 'test-secret' }))
            .toThrow('DATABASE_URL não configurada');
    });

    test('rejects missing JWT_SECRET', () => {
        expect(() => validarRuntime({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test' }))
            .toThrow('JWT_SECRET não configurado');
    });

    test('rejects weak JWT_SECRET in production', () => {
        expect(() => validarRuntime({
            NODE_ENV: 'production',
            DATABASE_URL: 'postgresql://prod',
            JWT_SECRET: '1234567890123456789012345678901',
            CORS_ORIGINS: 'https://staging.exemplo.com'
        })).toThrow('JWT_SECRET deve ter pelo menos 32 caracteres em produção');
    });

    test('rejects production without CORS_ORIGINS', () => {
        expect(() => validarRuntime({
            NODE_ENV: 'production',
            DATABASE_URL: 'postgresql://prod',
            JWT_SECRET: '12345678901234567890123456789012'
        })).toThrow('CORS_ORIGINS deve ser configurado em produção');
    });

    test('accepts valid production configuration', () => {
        expect(validarRuntime({
            NODE_ENV: 'production',
            DATABASE_URL: 'postgresql://prod',
            JWT_SECRET: '12345678901234567890123456789012',
            CORS_ORIGINS: 'https://app.exemplo.com'
        })).toEqual({
            nodeEnv: 'production',
            databaseUrlConfigured: true,
            corsOriginsConfigured: true
        });
    });

    test('rejects an invalid/unknown NODE_ENV', () => {
        expect(() => validarRuntime({
            NODE_ENV: 'homolog',
            DATABASE_URL: 'postgresql://x',
            JWT_SECRET: 'test-secret'
        })).toThrow('NODE_ENV inválido: homolog');
    });

    test('accepts valid staging configuration (NODE_ENV=staging, DATABASE_URL, JWT_SECRET forte e CORS_ORIGINS configurados)', () => {
        expect(validarRuntime({
            NODE_ENV: 'staging',
            DATABASE_URL: 'postgresql://staging',
            JWT_SECRET: '12345678901234567890123456789012',
            CORS_ORIGINS: 'https://staging.exemplo.com'
        })).toEqual({
            nodeEnv: 'staging',
            databaseUrlConfigured: true,
            corsOriginsConfigured: true
        });
    });

    test('rejects weak JWT_SECRET in staging (mesmo hardening de produção)', () => {
        expect(() => validarRuntime({
            NODE_ENV: 'staging',
            DATABASE_URL: 'postgresql://staging',
            JWT_SECRET: '1234567890123456789012345678901',
            CORS_ORIGINS: 'https://staging.exemplo.com'
        })).toThrow('JWT_SECRET deve ter pelo menos 32 caracteres em staging');
    });

    test('rejects staging without CORS_ORIGINS (mesmo hardening de produção)', () => {
        expect(() => validarRuntime({
            NODE_ENV: 'staging',
            DATABASE_URL: 'postgresql://staging',
            JWT_SECRET: '12345678901234567890123456789012'
        })).toThrow('CORS_ORIGINS deve ser configurado em staging');
    });
});

describe('validarRuntime — ambientes aceitos explicitamente', () => {
    const base = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        JWT_SECRET: 'x'.repeat(32),
        CORS_ORIGINS: 'https://app.exemplo.com'
    };

    test.each(['development', 'test', 'staging', 'production'])('aceita NODE_ENV=%s', (NODE_ENV) => {
        expect(() => validarRuntime({ ...base, NODE_ENV })).not.toThrow();
        expect(validarRuntime({ ...base, NODE_ENV }).nodeEnv).toBe(NODE_ENV);
    });

    test('regressão do boot: NODE_ENV=staging não é mais "inválido"', () => {
        expect(() => validarRuntime({ ...base, NODE_ENV: 'staging' })).not.toThrow(/NODE_ENV inválido/);
    });

    test.each(['stage', 'prod', 'Staging', 'homolog'])('continua rejeitando NODE_ENV=%s', (NODE_ENV) => {
        expect(() => validarRuntime({ ...base, NODE_ENV })).toThrow(`NODE_ENV inválido: ${NODE_ENV}`);
    });

    test.each(['staging', 'production'])('%s recebe o mesmo hardening (JWT forte e CORS obrigatórios)', (NODE_ENV) => {
        expect(() => validarRuntime({ ...base, NODE_ENV, JWT_SECRET: 'curto' })).toThrow(/JWT_SECRET deve ter pelo menos 32/);
        expect(() => validarRuntime({ ...base, NODE_ENV, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS deve ser configurado/);
    });

    test.each(['development', 'test'])('%s continua sem exigir JWT forte nem CORS', (NODE_ENV) => {
        expect(() => validarRuntime({ DATABASE_URL: base.DATABASE_URL, JWT_SECRET: 'curto', NODE_ENV })).not.toThrow();
    });
});
