jest.mock('../../src/repositories/moduloRepository');

const moduloRepository = require('../../src/repositories/moduloRepository');
const exigirModulo = require('../../src/middlewares/exigirModulo');

beforeEach(() => jest.clearAllMocks());

describe('exigirModulo', () => {
    test('recusa na montagem um módulo fora do catálogo', () => {
        expect(() => exigirModulo('inexistente')).toThrow('Módulo desconhecido');
    });

    test('403 sem usuário ou sem empresa, sem consultar o banco', async () => {
        const next = jest.fn();

        await exigirModulo('grade')({}, {}, next);
        await exigirModulo('grade')({ usuario: { id: 1 } }, {}, next);

        expect(next.mock.calls[0][0].statusCode).toBe(403);
        expect(next.mock.calls[1][0].statusCode).toBe(403);
        expect(moduloRepository.estaAtivo).not.toHaveBeenCalled();
    });

    test('403 quando o módulo está desligado (inclusive para admin)', async () => {
        moduloRepository.estaAtivo.mockResolvedValue(false);
        const next = jest.fn();

        await exigirModulo('fiscal')({ usuario: { id: 1, role: 'admin', empresa_id: 7 } }, {}, next);

        expect(next.mock.calls[0][0].statusCode).toBe(403);
    });

    test('libera quando ativo e consulta com a empresa do JWT', async () => {
        moduloRepository.estaAtivo.mockResolvedValue(true);
        const next = jest.fn();

        await exigirModulo('grade')({ usuario: { id: 1, role: 'vendedor', empresa_id: 7 } }, {}, next);

        expect(moduloRepository.estaAtivo).toHaveBeenCalledWith(7, 'grade');
        expect(next).toHaveBeenCalledWith();
    });

    test('falha fechada: erro de consulta vai para o handler, nunca libera', async () => {
        const falha = new Error('banco indisponível');
        moduloRepository.estaAtivo.mockRejectedValue(falha);
        const next = jest.fn();

        await exigirModulo('grade')({ usuario: { id: 1, empresa_id: 7 } }, {}, next);

        expect(next).toHaveBeenCalledWith(falha);
    });
});
