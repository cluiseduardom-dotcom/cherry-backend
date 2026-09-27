jest.mock('../src/repositories/contasPagarRepository', () => ({
    buscarPorRecebimentoId: jest.fn(),
    criar: jest.fn()
}));

const contasPagarRepository = require('../src/repositories/contasPagarRepository');
const service = require('../src/services/integracaoFinanceiraRecebimentoService');

function clientMock() {
    return { query: jest.fn() };
}

describe('integracaoFinanceiraRecebimentoService', () => {
    beforeEach(() => jest.clearAllMocks());

    test('cria conta a pagar vinculada ao recebimento', async () => {
        const client = clientMock();

        contasPagarRepository.buscarPorRecebimentoId.mockResolvedValue(null);
        contasPagarRepository.criar.mockResolvedValue({
            id: 800,
            recebimento_id: 10,
            valor: 300,
            data_vencimento: '2026-10-12'
        });

        client.query
            .mockResolvedValueOnce({
                rows: [{
                    id: 10,
                    empresa_id: 1,
                    data_recebimento: '2026-09-27',
                    numero_nf: '123',
                    numero_recebimento: 'REC-001',
                    pedido_compra_id: 20,
                    numero_pedido: 'PC-001',
                    prazo_pagamento_dias: 15,
                    data_vencimento: '2026-10-12',
                    fornecedor_nome: 'Fornecedor Teste'
                }]
            })
            .mockResolvedValueOnce({ rows: [{ valor_total: '300.00' }] });

        const result = await service.criarObrigacao(10, { empresa_id: 1, id: 99 }, client);

        expect(contasPagarRepository.criar).toHaveBeenCalledWith(
            expect.objectContaining({
                recebimento_id: 10,
                empresa_id: 1,
                fornecedor: 'Fornecedor Teste',
                valor: 300,
                data_vencimento: '2026-10-12'
            }),
            client
        );
        expect(result.conta_pagar.id).toBe(800);
    });

    test('é idempotente quando a obrigação já existe', async () => {
        const client = clientMock();
        const existente = { id: 800, recebimento_id: 10 };

        contasPagarRepository.buscarPorRecebimentoId.mockResolvedValue(existente);

        const result = await service.criarObrigacao(10, { empresa_id: 1, id: 99 }, client);

        expect(result).toEqual({ conta_pagar: existente, idempotente: true });
        expect(client.query).not.toHaveBeenCalled();
        expect(contasPagarRepository.criar).not.toHaveBeenCalled();
    });

    test('não cria obrigação para recebimento sem valor financeiro', async () => {
        const client = clientMock();
        contasPagarRepository.buscarPorRecebimentoId.mockResolvedValue(null);

        client.query
            .mockResolvedValueOnce({
                rows: [{
                    id: 10,
                    empresa_id: 1,
                    data_recebimento: '2026-09-27',
                    numero_nf: null,
                    numero_recebimento: 'REC-001',
                    pedido_compra_id: 20,
                    numero_pedido: 'PC-001',
                    prazo_pagamento_dias: 0,
                    data_vencimento: '2026-09-27',
                    fornecedor_nome: 'Fornecedor Teste'
                }]
            })
            .mockResolvedValueOnce({ rows: [{ valor_total: '0.00' }] });

        const result = await service.criarObrigacao(10, { empresa_id: 1, id: 99 }, client);

        expect(result.sem_obrigacao).toBe(true);
        expect(contasPagarRepository.criar).not.toHaveBeenCalled();
    });
});
