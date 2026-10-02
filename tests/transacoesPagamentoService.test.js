jest.mock('../src/repositories/transacoesPagamentoRepository',()=>({
    criar:jest.fn(),criarParcela:jest.fn(),buscarPorId:jest.fn(),listarParcelas:jest.fn()
}));

const repository=require('../src/repositories/transacoesPagamentoRepository');
const service=require('../src/services/transacoesPagamentoService');

describe('transacoesPagamentoService',()=>{
    beforeEach(()=>jest.clearAllMocks());

    test('registra pagamento manual',async()=>{
        repository.criar.mockResolvedValue({id:1,status:'PENDENTE',valor_liquido:970});
        await expect(service.criar({
            tipo:'PAGAMENTO',forma_pagamento:'PIX',valor:1000,taxa:30
        },{id:5,empresa_id:10})).resolves.toEqual({
            id:1,status:'PENDENTE',valor_liquido:970
        });
        expect(repository.criar).toHaveBeenCalledWith(expect.objectContaining({
            empresa_id:10,usuario_id:5,taxa:30,valor_liquido:970
        }));
    });

    test('recusa forma de pagamento inválida',async()=>{
        await expect(service.criar({
            tipo:'PAGAMENTO',forma_pagamento:'CHEQUE',valor:100
        },{id:5,empresa_id:10})).rejects.toMatchObject({statusCode:400});
        expect(repository.criar).not.toHaveBeenCalled();
    });

    test('não permite taxa maior que o valor',async()=>{
        await expect(service.criar({
            tipo:'RECEBIMENTO',forma_pagamento:'CREDITO',valor:100,taxa:101
        },{id:5,empresa_id:10})).rejects.toMatchObject({statusCode:400});
    });

    test('isola parcela por empresa',async()=>{
        repository.buscarPorId.mockResolvedValue(null);
        await expect(service.criarParcela(1,{numero:1,valor:100},{empresa_id:99}))
            .rejects.toMatchObject({statusCode:404});
    });
});
