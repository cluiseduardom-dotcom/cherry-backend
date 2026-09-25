jest.mock('../src/repositories/recebimentosRepository', () => ({
    criar: jest.fn(),
    adicionarItem: jest.fn(),
    buscarPorId: jest.fn(),
    buscarPedidoItem: jest.fn(),
    quantidadeJaRecebida: jest.fn(),
    listarItens: jest.fn(),
    atualizarStatus: jest.fn(),
    listar: jest.fn()
}));

const repository=require('../src/repositories/recebimentosRepository');
const service=require('../src/services/recebimentosService');

describe('recebimentosService',()=>{
    beforeEach(()=>jest.clearAllMocks());

    test('cria recebimento com pedido e fornecedor',async()=>{
        repository.criar.mockResolvedValue({id:1,status:'RASCUNHO'});
        await expect(service.criar({
            empresa_id:10,numero:'REC-2026-000001',
            pedido_compra_id:20,fornecedor_id:30
        })).resolves.toEqual({id:1,status:'RASCUNHO'});
    });

    test('valida chave NF-e',async()=>{
        await expect(service.criar({
            empresa_id:10,numero:'REC-2026-000001',
            pedido_compra_id:20,fornecedor_id:30,chave_nf:'123'
        })).rejects.toMatchObject({statusCode:400});
        expect(repository.criar).not.toHaveBeenCalled();
    });

    test('adiciona recebimento parcial',async()=>{
        repository.buscarPorId.mockResolvedValue({id:1,empresa_id:10,status:'RASCUNHO'});
        repository.buscarPedidoItem.mockResolvedValue({
            id:2,empresa_id:10,quantidade:100,produto_id:50,unidade:'UN',preco_unitario:12
        });
        repository.quantidadeJaRecebida.mockResolvedValue(40);
        repository.adicionarItem.mockResolvedValue({id:3,quantidade_recebida:30});

        await expect(service.adicionarItem(1,{
            pedido_compra_item_id:2,
            descricao_snapshot:'Produto',
            quantidade_recebida:30
        },{empresa_id:10})).resolves.toEqual({id:3,quantidade_recebida:30});
    });

    test('não permite receber acima do saldo do PC',async()=>{
        repository.buscarPorId.mockResolvedValue({id:1,empresa_id:10,status:'RASCUNHO'});
        repository.buscarPedidoItem.mockResolvedValue({id:2,empresa_id:10,quantidade:100});
        repository.quantidadeJaRecebida.mockResolvedValue(80);

        await expect(service.adicionarItem(1,{
            pedido_compra_item_id:2,
            descricao_snapshot:'Produto',
            quantidade_recebida:30
        },{empresa_id:10})).rejects.toMatchObject({statusCode:409});
        expect(repository.adicionarItem).not.toHaveBeenCalled();
    });

    test('bloqueia alteração depois de aprovado',async()=>{
        repository.buscarPorId.mockResolvedValue({id:1,empresa_id:10,status:'APROVADO'});
        await expect(service.alterarStatus(1,'EM_CONFERENCIA',{empresa_id:10}))
            .rejects.toMatchObject({statusCode:409});
        expect(repository.atualizarStatus).not.toHaveBeenCalled();
    });

    test('permite conferido virar aprovado',async()=>{
        repository.buscarPorId.mockResolvedValue({id:1,empresa_id:10,status:'CONFERIDO'});
        repository.atualizarStatus.mockResolvedValue({id:1,status:'APROVADO'});
        await expect(service.alterarStatus(1,'APROVADO',{empresa_id:10}))
            .resolves.toEqual({id:1,status:'APROVADO'});
    });
});
