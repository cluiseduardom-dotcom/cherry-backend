jest.mock('../src/repositories/ordensCompraRepository', () => ({
    criar: jest.fn(),
    adicionarItem: jest.fn(),
    buscarPorId: jest.fn(),
    listarItens: jest.fn(),
    listar: jest.fn()
}));

const repository = require('../src/repositories/ordensCompraRepository');
const service = require('../src/services/ordensCompraService');

describe('ordensCompraService', () => {
    beforeEach(() => jest.clearAllMocks());

    test('cria OC planejada', async () => {
        repository.criar.mockResolvedValue({ id: 1, status: 'RASCUNHO' });
        await expect(service.criar({ empresa_id: 10, numero: 'OC-2026-000001' }))
            .resolves.toEqual({ id: 1, status: 'RASCUNHO' });
    });

    test('rejeita origem inválida', async () => {
        await expect(service.criar({ origem: 'INVALIDA' }))
            .rejects.toMatchObject({ statusCode: 400 });
        expect(repository.criar).not.toHaveBeenCalled();
    });

    test('não permite adicionar item em OC aprovada', async () => {
        repository.buscarPorId.mockResolvedValue({ id: 1, empresa_id: 10, status: 'APROVADA' });
        await expect(service.adicionarItem(1, {
            descricao_snapshot: 'Produto',
            quantidade_solicitada: 10
        }, { empresa_id: 10 })).rejects.toMatchObject({ statusCode: 409 });
    });

    test('adiciona item em OC em rascunho', async () => {
        repository.buscarPorId.mockResolvedValue({ id: 1, empresa_id: 10, status: 'RASCUNHO' });
        repository.adicionarItem.mockResolvedValue({ id: 2, quantidade_solicitada: 10 });

        await expect(service.adicionarItem(1, {
            descricao_snapshot: 'Produto',
            quantidade_solicitada: 10
        }, { empresa_id: 10 })).resolves.toEqual({ id: 2, quantidade_solicitada: 10 });
    });

    test('isolamento por empresa ao obter OC', async () => {
        repository.buscarPorId.mockResolvedValue(null);
        await expect(service.obter(1, { empresa_id: 99 }))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(repository.buscarPorId).toHaveBeenCalledWith(1, 99);
    });
});
