const protegerInterno = require('../../src/middlewares/protegerInterno');

const SEGREDO = 'segredo-interno-de-teste-nao-real-123';

function executar({ cabecalho, env = {} } = {}) {
    const original = { i: process.env.INTERNO_SECRET, o: process.env.ONBOARDING_SECRET };
    if (env.INTERNO_SECRET === undefined && !('INTERNO_SECRET' in env)) process.env.INTERNO_SECRET = SEGREDO;
    Object.entries(env).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });

    const req = { method: 'GET', baseUrl: '/interno', ip: '127.0.0.1', get: jest.fn(() => cabecalho) };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    try {
        protegerInterno(req, res, next);
    } finally {
        if (original.i === undefined) delete process.env.INTERNO_SECRET; else process.env.INTERNO_SECRET = original.i;
        if (original.o === undefined) delete process.env.ONBOARDING_SECRET; else process.env.ONBOARDING_SECRET = original.o;
    }

    return { res, next };
}

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('protegerInterno', () => {
    test('libera com o segredo correto', () => {
        const { next, res } = executar({ cabecalho: SEGREDO });

        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('401 sem cabeçalho ou com segredo errado', () => {
        for (const cabecalho of [undefined, 'errado', SEGREDO + 'x', '']) {
            const { res, next } = executar({ cabecalho });

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        }
    });

    test('503 (fail-closed) quando o segredo não está configurado, mesmo em test/dev', () => {
        const { res, next } = executar({ cabecalho: SEGREDO, env: { INTERNO_SECRET: undefined } });

        expect(res.status).toHaveBeenCalledWith(503);
        expect(next).not.toHaveBeenCalled();
    });

    test('503 quando o segredo é curto demais', () => {
        const { res, next } = executar({ cabecalho: 'curto', env: { INTERNO_SECRET: 'curto' } });

        expect(res.status).toHaveBeenCalledWith(503);
        expect(next).not.toHaveBeenCalled();
    });

    test('503 quando o segredo é igual ao do onboarding (segredos devem ser distintos)', () => {
        const { res, next } = executar({ cabecalho: SEGREDO, env: { ONBOARDING_SECRET: SEGREDO } });

        expect(res.status).toHaveBeenCalledWith(503);
        expect(next).not.toHaveBeenCalled();
    });

    test('a auditoria nunca registra o segredo nem o valor recebido', () => {
        executar({ cabecalho: 'valor-recebido-sigiloso' });
        executar({ cabecalho: SEGREDO });

        const linhas = [...console.warn.mock.calls, ...console.info.mock.calls].flat().join('\n');

        expect(linhas).not.toContain(SEGREDO);
        expect(linhas).not.toContain('valor-recebido-sigiloso');
    });
});
