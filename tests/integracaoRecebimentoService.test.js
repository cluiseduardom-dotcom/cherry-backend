jest.mock('../src/config/db', () => ({
    connect: jest.fn()
}));

jest.mock('../src/repositories/estoqueRepository', () => ({
    criarMovimentacao: jest.fn()
}));

jest.mock('../src/repositories/eventosNegocioRepository', () => ({
    criar: jest.fn(),
    buscarPorEntidade: jest.fn(),
    marcarProcessando: jest.fn(),
    marcarProcessado: jest.fn()
}));

jest.mock('../src/services/integracaoFinanceiraRecebimentoService', () => ({
    criarObrigacao: jest.fn()
}));

jest.mock('../src/repositories/integracaoRecebimentoRepository', () => ({
    buscarPorIdForUpdate: jest.fn(),
    listarItens: jest.fn(),
    atualizarStatusComCliente: jest.fn(),
    atualizarQuantidadeRecebidaPedidoItem: jest.fn(),
    atualizarStatusPedido: jest.fn(),
    atualizarOrdensRelacionadas: jest.fn(),
    atualizarStatusOrdensRelacionadas: jest.fn()
}));

const db = require('../src/config/db');
const estoqueRepository = require('../src/repositories/estoqueRepository');
const eventosRepository = require('../src/repositories/eventosNegocioRepository');
const repository = require('../src/repositories/integracaoRecebimentoRepository');
const financeiroRecebimentoService = require('../src/services/integracaoFinanceiraRecebimentoService');
const service = require('../src/services/integracaoRecebimentoService');

function clientMock() {
    return {
        query: jest.fn(),
        release: jest.fn()
    };
}

describe('integracaoRecebimentoService', () => {
    beforeEach(() => jest.clearAllMocks());

    test('aprova recebimento e integra estoque, pedido, OC e evento na mesma operação', async () => {
        const client = clientMock();
        db.connect.mockResolvedValue(client);

        repository.buscarPorIdForUpdate.mockResolvedValue({
            id: 10,
            empresa_id: 1,
            filial_id: 2,
            status: 'CONFERIDO',
            pedido_compra_id: 20,
            fornecedor_id: 30
        });
        repository.listarItens.mockResolvedValue([
            {
                id: 100,
                pedido_compra_item_id: 200,
                produto_id: 500,
                quantidade_recebida: 3,
                unidade: 'UN'
            }
        ]);
        estoqueRepository.criarMovimentacao.mockResolvedValue({
            movimentacao: { id: 900 }
        });
        repository.atualizarQuantidadeRecebidaPedidoItem.mockResolvedValue({
            id: 200,
            quantidade_recebida: 3
        });
        repository.atualizarStatusPedido.mockResolvedValue({
            id: 20,
            status: 'PARCIALMENTE_RECEBIDO'
        });
        repository.atualizarOrdensRelacionadas.mockResolvedValue([]);
        repository.atualizarStatusOrdensRelacionadas.mockResolvedValue([]);
        repository.atualizarStatusComCliente.mockResolvedValue({
            id: 10,
            status: 'APROVADO'
        });
        eventosRepository.criar.mockResolvedValue({ id: 700 });
        eventosRepository.marcarProcessando.mockResolvedValue({ id: 700 });
        eventosRepository.marcarProcessado.mockResolvedValue({
            id: 700,
            status: 'PROCESSADO'
        });
        financeiroRecebimentoService.criarObrigacao.mockResolvedValue({
            conta_pagar: { id: 800 },
            idempotente: false
        });

        const result = await service.aprovar(10, { empresa_id: 1, id: 99 });

        expect(client.query).toHaveBeenCalledWith('BEGIN');
        expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
            expect.objectContaining({
                produto_id: 500,
                tipo: 'entrada',
                quantidade: 3,
                empresa_id: 1
            }),
            client
        );
        expect(repository.atualizarQuantidadeRecebidaPedidoItem).toHaveBeenCalledWith(200, 1, client);
        expect(repository.atualizarStatusPedido).toHaveBeenCalledWith(20, 1, client);
        expect(financeiroRecebimentoService.criarObrigacao).toHaveBeenCalledWith(10, { empresa_id: 1, id: 99 }, client);
        expect(eventosRepository.criar).toHaveBeenCalledWith(
            expect.objectContaining({
                empresa_id: 1,
                tipo_evento: 'RECEBIMENTO_APROVADO',
                entidade_tipo: 'RECEBIMENTO',
                entidade_id: 10
            }),
            client
        );
        expect(result.recebimento.status).toBe('APROVADO');
        expect(result.conta_pagar.id).toBe(800);
        expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    test('é idempotente quando recebimento já está aprovado', async () => {
        const client = clientMock();
        db.connect.mockResolvedValue(client);
        repository.buscarPorIdForUpdate.mockResolvedValue({
            id: 10,
            empresa_id: 1,
            status: 'APROVADO'
        });
        eventosRepository.buscarPorEntidade.mockResolvedValue({ id: 700, status: 'PROCESSADO' });
        financeiroRecebimentoService.criarObrigacao.mockResolvedValue({
            conta_pagar: { id: 800 },
            idempotente: true
        });

        const result = await service.aprovar(10, { empresa_id: 1, id: 99 });

        expect(result.idempotente).toBe(true);
        expect(financeiroRecebimentoService.criarObrigacao).toHaveBeenCalledWith(10, { empresa_id: 1, id: 99 }, client);
        expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
        expect(eventosRepository.criar).not.toHaveBeenCalled();
        expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    test('não aprova recebimento sem itens', async () => {
        const client = clientMock();
        db.connect.mockResolvedValue(client);
        repository.buscarPorIdForUpdate.mockResolvedValue({
            id: 10,
            empresa_id: 1,
            status: 'CONFERIDO'
        });
        repository.listarItens.mockResolvedValue([]);

        await expect(service.aprovar(10, { empresa_id: 1, id: 99 }))
            .rejects.toMatchObject({ statusCode: 409 });

        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });
});
