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
