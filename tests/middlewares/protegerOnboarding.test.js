'use strict';

const protegerOnboarding = require('../../src/middlewares/protegerOnboarding');

describe('protegerOnboarding', () => {
    const ambienteOriginal = process.env.NODE_ENV;
    const secretOriginal = process.env.ONBOARDING_SECRET;

    let req;
    let res;
    let next;

    beforeEach(() => {
        req = { get: jest.fn() };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        next = jest.fn();
        delete process.env.ONBOARDING_SECRET;
    });

    afterEach(() => {
        if (ambienteOriginal === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = ambienteOriginal;

        if (secretOriginal === undefined) delete process.env.ONBOARDING_SECRET;
        else process.env.ONBOARDING_SECRET = secretOriginal;

        jest.restoreAllMocks();
    });

    test.each(['development', 'test'])(
        'permite ambiente local/test (%s) sem segredo',
        (ambiente) => {
            process.env.NODE_ENV = ambiente;

            protegerOnboarding(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        }
    );

    test.each([undefined, '', '   '])(
        'retorna 503 em ambiente não local quando segredo não está configurado (%s)',
        (secret) => {
            process.env.NODE_ENV = 'production';
            if (secret === undefined) delete process.env.ONBOARDING_SECRET;
            else process.env.ONBOARDING_SECRET = secret;

            protegerOnboarding(req, res, next);

            expect(res.status).toHaveBeenCalledWith(503);
            expect(res.json).toHaveBeenCalledWith({
                erro: 'Provisionamento temporariamente indisponível',
            });
            expect(next).not.toHaveBeenCalled();
        }
    );

    test('falha fechado quando NODE_ENV não está definido', () => {
        delete process.env.NODE_ENV;

        protegerOnboarding(req, res, next);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(next).not.toHaveBeenCalled();
    });

    test('retorna 401 quando o cabeçalho não é enviado', () => {
        process.env.NODE_ENV = 'production';
        process.env.ONBOARDING_SECRET = 'segredo-forte-de-teste';
        req.get.mockReturnValue(undefined);

        protegerOnboarding(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ erro: 'Não autorizado' });
        expect(next).not.toHaveBeenCalled();
    });

    test('retorna 401 quando o segredo está incorreto', () => {
        process.env.NODE_ENV = 'production';
        process.env.ONBOARDING_SECRET = 'segredo-forte-de-teste';
        req.get.mockReturnValue('segredo-errado');

        protegerOnboarding(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('permite o segredo correto em ambiente não local', () => {
        process.env.NODE_ENV = 'production';
        process.env.ONBOARDING_SECRET = 'segredo-forte-de-teste';
        req.get.mockReturnValue('segredo-forte-de-teste');

        protegerOnboarding(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });
});
