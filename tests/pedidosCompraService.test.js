jest.mock('../src/repositories/pedidosCompraRepository', () => ({
    criar: jest.fn(),
    adicionarItem: jest.fn(),
    recalcularTotal: jest.fn(),
    buscarPorId: jest.fn(),
    listarItens: jest.fn(),
    atualizarStatus: jest.fn(),
    listar: jest.fn()
}));

const repository = require('../src/repositories/pedidosCompraRepository');
const service = require('../src/services/pedidosCompraService');

describe('pedidosCompraService', () => {
    beforeEach(() => jest.clearAllMocks());

    test('cria pedido de compra com fornecedor', async () => {
        repository.criar.mockResolvedValue({
            id: 1,
            fornecedor_id: 20,
            status: 'RASCUNHO'
        });

        await expect(service.criar({
            empresa_id: 10,
            numero: 'PC-2026-000001',
            fornecedor_id: 20
        })).resolves.toEqual({
            id: 1,
            fornecedor_id: 20,
            status: 'RASCUNHO'
        });
    });

    test('exige fornecedor', async () => {
        await expect(service.criar({
            empresa_id: 10,
            numero: 'PC-2026-000001'
        })).rejects.toMatchObject({ statusCode: 400 });

        expect(repository.criar).not.toHaveBeenCalled();
    });

    test('adiciona item e recalcula total no rascunho', async () => {
        repository.buscarPorId.mockResolvedValue({
            id: 1, empresa_id: 10, status: 'RASCUNHO'
        });
        repository.adicionarItem.mockResolvedValue({
            id: 2, quantidade: 10, preco_unitario: 25
        });

        await expect(service.adicionarItem(1, {
            descricao_snapshot: 'Produto',
            quantidade: 10,
            preco_unitario: 25
        }, { empresa_id: 10 })).resolves.toEqual({
            id: 2, quantidade: 10, preco_unitario: 25
        });

        expect(repository.recalcularTotal).toHaveBeenCalledWith(1, 10);
    });

    test('não permite alterar item em pedido já enviado', async () => {
        repository.buscarPorId.mockResolvedValue({
            id: 1, empresa_id: 10, status: 'ENVIADO'
        });

        await expect(service.adicionarItem(1, {
            descricao_snapshot: 'Produto',
            quantidade: 10,
            preco_unitario: 25
        }, { empresa_id: 10 })).rejects.toMatchObject({ statusCode: 409 });
    });

    test('permite voltar aprovação para rascunho', async () => {
        repository.buscarPorId.mockResolvedValue({
            id: 1, empresa_id: 10, status: 'PENDENTE_APROVACAO'
        });
        repository.atualizarStatus.mockResolvedValue({
            id: 1, status: 'RASCUNHO'
        });

        await expect(service.alterarStatus(
            1, 'RASCUNHO', { empresa_id: 10 }
        )).resolves.toEqual({ id: 1, status: 'RASCUNHO' });
    });

    test('marca data de envio ao enviar', async () => {
        repository.buscarPorId.mockResolvedValue({
            id: 1, empresa_id: 10, status: 'APROVADO'
        });
        repository.atualizarStatus.mockResolvedValue({
            id: 1, status: 'ENVIADO'
        });

        await expect(service.alterarStatus(
            1, 'ENVIADO', { empresa_id: 10 }
        )).resolves.toEqual({ id: 1, status: 'ENVIADO' });

        expect(repository.atualizarStatus).toHaveBeenCalledWith(
            1, 10, 'ENVIADO', expect.objectContaining({
                enviado_em: expect.any(String)
            })
        );
    });

    test('bloqueia transição inválida', async () => {
        repository.buscarPorId.mockResolvedValue({
            id: 1, empresa_id: 10, status: 'RECEBIDO'
        });

        await expect(service.alterarStatus(
            1, 'RASCUNHO', { empresa_id: 10 }
        )).rejects.toMatchObject({ statusCode: 409 });

        expect(repository.atualizarStatus).not.toHaveBeenCalled();
    });

    test('isolamento por empresa ao obter pedido', async () => {
        repository.buscarPorId.mockResolvedValue(null);

        await expect(service.obter(1, { empresa_id: 99 }))
            .rejects.toMatchObject({ statusCode: 404 });

        expect(repository.buscarPorId).toHaveBeenCalledWith(1, 99);
    });
});
