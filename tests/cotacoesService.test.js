jest.mock('../src/repositories/cotacoesRepository', () => ({
    criar: jest.fn(),
    adicionarItem: jest.fn(),
    adicionarFornecedor: jest.fn(),
    adicionarOferta: jest.fn(),
    buscarPorId: jest.fn(),
    buscarFornecedor: jest.fn(),
    buscarItem: jest.fn(),
    listarItens: jest.fn(),
    listarFornecedores: jest.fn(),
    listarOfertas: jest.fn(),
    atualizarStatus: jest.fn(),
    listar: jest.fn()
}));

const repository = require('../src/repositories/cotacoesRepository');
const service = require('../src/services/cotacoesService');

describe('cotacoesService', () => {
    beforeEach(() => jest.clearAllMocks());

    test('cria cotação', async () => {
        repository.criar.mockResolvedValue({ id: 1, status: 'RASCUNHO' });

        await expect(service.criar({
            empresa_id: 10,
            numero: 'COT-2026-000001'
        })).resolves.toEqual({ id: 1, status: 'RASCUNHO' });
    });

    test('exige número da cotação', async () => {
        await expect(service.criar({ empresa_id: 10 }))
            .rejects.toMatchObject({ statusCode: 400 });
        expect(repository.criar).not.toHaveBeenCalled();
    });

    test('não permite adicionar item após abertura', async () => {
        repository.buscarPorId.mockResolvedValue({
            id: 1, empresa_id: 10, status: 'ABERTA'
        });

        await expect(service.adicionarItem(1, {
            descricao_snapshot: 'Produto',
            quantidade_solicitada: 10
        }, { empresa_id: 10 })).rejects.toMatchObject({ statusCode: 409 });
    });

    test('adiciona fornecedor em rascunho', async () => {
        repository.buscarPorId.mockResolvedValue({
            id: 1, empresa_id: 10, status: 'RASCUNHO'
        });
        repository.adicionarFornecedor.mockResolvedValue({
            id: 2, fornecedor_id: 30
        });

        await expect(service.adicionarFornecedor(1, {
            fornecedor_id: 30
        }, { empresa_id: 10 })).resolves.toEqual({
            id: 2, fornecedor_id: 30
        });
    });

    test('abre cotação em rascunho', async () => {
        repository.buscarPorId.mockResolvedValue({
            id: 1, empresa_id: 10, status: 'RASCUNHO'
        });
        repository.atualizarStatus.mockResolvedValue({
            id: 1, status: 'ABERTA'
        });

        await expect(service.abrir(1, { empresa_id: 10 }))
            .resolves.toEqual({ id: 1, status: 'ABERTA' });

        expect(repository.atualizarStatus).toHaveBeenCalledWith(
            1, 10, 'ABERTA', expect.objectContaining({ data_abertura: expect.any(String) })
        );
    });

    test('só aceita oferta com preço não negativo', async () => {
        await expect(service.adicionarOferta(2, {
            cotacao_item_id: 5,
            quantidade_ofertada: 10,
            preco_unitario: -1
        }, { empresa_id: 10 })).rejects.toMatchObject({ statusCode: 400 });

        expect(repository.adicionarOferta).not.toHaveBeenCalled();
    });

    test('rejeita oferta para item de outra cotação', async () => {
        repository.buscarFornecedor.mockResolvedValue({
            id: 2, empresa_id: 10, cotacao_id: 1, fornecedor_id: 30
        });
        repository.buscarPorId.mockResolvedValue({
            id: 1, empresa_id: 10, status: 'ABERTA'
        });
        repository.buscarItem.mockResolvedValue({
            id: 5, empresa_id: 10, cotacao_id: 99
        });

        await expect(service.adicionarOferta(2, {
            cotacao_item_id: 5,
            quantidade_ofertada: 10,
            preco_unitario: 10
        }, { empresa_id: 10 })).rejects.toMatchObject({ statusCode: 400 });

        expect(repository.adicionarOferta).not.toHaveBeenCalled();
    });

    test('adiciona oferta somente com cotação aberta', async () => {
        repository.buscarFornecedor.mockResolvedValue({
            id: 2, empresa_id: 10, cotacao_id: 1, fornecedor_id: 30
        });
        repository.buscarPorId.mockResolvedValue({
            id: 1, empresa_id: 10, status: 'ABERTA'
        });
        repository.buscarItem.mockResolvedValue({
            id: 5, empresa_id: 10, cotacao_id: 1
        });
        repository.adicionarOferta.mockResolvedValue({
            id: 8, preco_unitario: 12.5
        });

        await expect(service.adicionarOferta(2, {
            cotacao_item_id: 5,
            quantidade_ofertada: 10,
            preco_unitario: 12.5
        }, { empresa_id: 10 })).resolves.toEqual({
            id: 8, preco_unitario: 12.5
        });
    });

    test('isolamento por empresa ao obter cotação', async () => {
        repository.buscarPorId.mockResolvedValue(null);

        await expect(service.obter(1, { empresa_id: 99 }))
            .rejects.toMatchObject({ statusCode: 404 });

        expect(repository.buscarPorId).toHaveBeenCalledWith(1, 99);
    });
});
