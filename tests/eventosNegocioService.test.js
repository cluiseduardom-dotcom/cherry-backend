jest.mock('../src/repositories/eventosNegocioRepository', () => ({
    criar: jest.fn(),
    buscarPorId: jest.fn(),
    marcarProcessando: jest.fn(),
    marcarProcessado: jest.fn(),
    marcarErro: jest.fn()
}));

const repository = require('../src/repositories/eventosNegocioRepository');
const service = require('../src/services/eventosNegocioService');

describe('eventosNegocioService', () => {
    beforeEach(() => jest.clearAllMocks());

    test('valida e registra evento permitido', async () => {
        const evento = {
            id: 1,
            empresa_id: 10,
            tipo_evento: 'RECEBIMENTO_APROVADO',
            entidade_tipo: 'RECEBIMENTO',
            entidade_id: 20,
            payload: { teste: true },
            status: 'PENDENTE'
        };
        repository.criar.mockResolvedValue(evento);

        await expect(service.registrar({
            empresa_id: 10,
            tipo_evento: 'RECEBIMENTO_APROVADO',
            entidade_tipo: 'RECEBIMENTO',
            entidade_id: '20',
            payload: { teste: true }
        })).resolves.toEqual(evento);

        expect(repository.criar).toHaveBeenCalledWith(
            expect.objectContaining({ entidade_id: 20, payload: { teste: true } }),
            undefined
        );
    });

    test('rejeita tipo de evento desconhecido', async () => {
        await expect(service.registrar({
            empresa_id: 10,
            tipo_evento: 'EVENTO_INEXISTENTE',
            entidade_tipo: 'X',
            entidade_id: 1
        })).rejects.toMatchObject({ statusCode: 400 });

        expect(repository.criar).not.toHaveBeenCalled();
    });

    test('processa evento com sucesso e marca como processado', async () => {
        const evento = { id: 5, empresa_id: 10, status: 'PENDENTE' };
        const reservado = { ...evento, status: 'PROCESSANDO', tentativas: 1 };
        const processado = { ...reservado, status: 'PROCESSADO' };

        repository.buscarPorId.mockResolvedValue(evento);
        repository.marcarProcessando.mockResolvedValue(reservado);
        repository.marcarProcessado.mockResolvedValue(processado);

        const handler = jest.fn().mockResolvedValue();

        await expect(service.processarUm(5, 10, handler)).resolves.toEqual(processado);
        expect(handler).toHaveBeenCalledWith(reservado);
        expect(repository.marcarProcessado).toHaveBeenCalledWith(5, 10, undefined);
    });

    test('marca erro quando handler falha', async () => {
        const evento = { id: 6, empresa_id: 10, status: 'PENDENTE' };
        const reservado = { ...evento, status: 'PROCESSANDO', tentativas: 1 };
        const erro = new Error('falha de teste');

        repository.buscarPorId.mockResolvedValue(evento);
        repository.marcarProcessando.mockResolvedValue(reservado);
        repository.marcarErro.mockResolvedValue({ ...reservado, status: 'ERRO', erro: erro.message });

        await expect(
            service.processarUm(6, 10, jest.fn().mockRejectedValue(erro))
        ).rejects.toThrow('falha de teste');

        expect(repository.marcarErro).toHaveBeenCalledWith(6, 10, 'falha de teste', undefined);
    });
});
