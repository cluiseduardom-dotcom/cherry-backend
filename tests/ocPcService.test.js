jest.mock('../src/repositories/ocPcRepository', () => ({
    buscarOcItem: jest.fn(),
    buscarPcItem: jest.fn(),
    quantidadeVinculadaOcItem: jest.fn(),
    quantidadeVinculadaPcItem: jest.fn(),
    criarVinculo: jest.fn(),
    listarPorOc: jest.fn(),
    listarPorPc: jest.fn()
}));

const repository = require('../src/repositories/ocPcRepository');
const service = require('../src/services/ocPcService');

describe('ocPcService', () => {
    beforeEach(() => jest.clearAllMocks());

    test('vincula item da OC a item do PC', async () => {
        repository.buscarOcItem.mockResolvedValue({
            id: 1,
            empresa_id: 10,
            quantidade_solicitada: 100
        });
        repository.buscarPcItem.mockResolvedValue({
            id: 2,
            empresa_id: 10,
            quantidade: 60
        });
        repository.quantidadeVinculadaOcItem.mockResolvedValue(0);
        repository.quantidadeVinculadaPcItem.mockResolvedValue(0);
        repository.criarVinculo.mockResolvedValue({
            id: 3,
            quantidade_vinculada: 60
        });

        await expect(service.vincular({
            ordem_compra_item_id: 1,
            pedido_compra_item_id: 2,
            quantidade_vinculada: 60
        }, { empresa_id: 10 })).resolves.toEqual({
            id: 3,
            quantidade_vinculada: 60
        });
    });

    test('não permite exceder saldo da OC', async () => {
        repository.buscarOcItem.mockResolvedValue({
            id: 1,
            empresa_id: 10,
            quantidade_solicitada: 100
        });
        repository.buscarPcItem.mockResolvedValue({
            id: 2,
            empresa_id: 10,
            quantidade: 60
        });
        repository.quantidadeVinculadaOcItem.mockResolvedValue(50);
        repository.quantidadeVinculadaPcItem.mockResolvedValue(0);

        await expect(service.vincular({
            ordem_compra_item_id: 1,
            pedido_compra_item_id: 2,
            quantidade_vinculada: 60
        }, { empresa_id: 10 })).rejects.toMatchObject({ statusCode: 409 });

        expect(repository.criarVinculo).not.toHaveBeenCalled();
    });

    test('não permite exceder quantidade do PC', async () => {
        repository.buscarOcItem.mockResolvedValue({
            id: 1,
            empresa_id: 10,
            quantidade_solicitada: 100
        });
        repository.buscarPcItem.mockResolvedValue({
            id: 2,
            empresa_id: 10,
            quantidade: 60
        });
        repository.quantidadeVinculadaOcItem.mockResolvedValue(0);
        repository.quantidadeVinculadaPcItem.mockResolvedValue(40);

        await expect(service.vincular({
            ordem_compra_item_id: 1,
            pedido_compra_item_id: 2,
            quantidade_vinculada: 30
        }, { empresa_id: 10 })).rejects.toMatchObject({ statusCode: 409 });

        expect(repository.criarVinculo).not.toHaveBeenCalled();
    });

    test('não aceita item de outra empresa', async () => {
        repository.buscarOcItem.mockResolvedValue(null);

        await expect(service.vincular({
            ordem_compra_item_id: 1,
            pedido_compra_item_id: 2,
            quantidade_vinculada: 10
        }, { empresa_id: 99 })).rejects.toMatchObject({ statusCode: 404 });
    });

    test('não aceita quantidade zero', async () => {
        await expect(service.vincular({
            ordem_compra_item_id: 1,
            pedido_compra_item_id: 2,
            quantidade_vinculada: 0
        }, { empresa_id: 10 })).rejects.toMatchObject({ statusCode: 400 });

        expect(repository.buscarOcItem).not.toHaveBeenCalled();
    });
});
