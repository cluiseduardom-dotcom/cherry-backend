'use strict';

const protegerOnboarding = require('../src/middlewares/protegerOnboarding');

describe('protegerOnboarding audit logging', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.ONBOARDING_SECRET;
    let req;
    let res;
    let next;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        process.env.ONBOARDING_SECRET = 'segredo-de-teste-nao-real';
        req = { method: 'POST', ip: '192.0.2.10', get: jest.fn() };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
        next = jest.fn();
        jest.spyOn(console, 'info').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalEnv;
        if (originalSecret === undefined) delete process.env.ONBOARDING_SECRET;
        else process.env.ONBOARDING_SECRET = originalSecret;
        jest.restoreAllMocks();
    });

    test('logs accepted credential decision without logging the secret', () => {
        req.get.mockReturnValue('segredo-de-teste-nao-real');

        protegerOnboarding(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        const log = console.info.mock.calls[0][0];
        expect(log).toContain('onboarding_credencial_aceita');
        expect(log).toContain('192.0.2.10');
        expect(log).not.toContain('segredo-de-teste-nao-real');
    });

    test('logs rejected request without logging supplied credential', () => {
        req.get.mockReturnValue('credencial-incorreta');

        protegerOnboarding(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        const log = console.warn.mock.calls[0][0];
        expect(log).toContain('onboarding_credencial_rejeitada');
        expect(log).toContain('credencial_invalida');
        expect(log).not.toContain('credencial-incorreta');
    });

    test('logs missing configuration without disclosing secret values', () => {
        delete process.env.ONBOARDING_SECRET;

        protegerOnboarding(req, res, next);

        expect(res.status).toHaveBeenCalledWith(503);
        const log = console.warn.mock.calls[0][0];
        expect(log).toContain('onboarding_indisponivel');
        expect(log).toContain('segredo_nao_configurado');
    });
});
