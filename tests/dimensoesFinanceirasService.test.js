jest.mock('../src/repositories/dimensoesFinanceirasRepository',()=>({
    criarCentroCusto:jest.fn(),
    listarCentrosCusto:jest.fn(),
    criarProjeto:jest.fn(),
    listarProjetos:jest.fn()
}));

const repository=require('../src/repositories/dimensoesFinanceirasRepository');
const service=require('../src/services/dimensoesFinanceirasService');

describe('dimensoesFinanceirasService',()=>{
    beforeEach(()=>jest.clearAllMocks());

    test('cria centro de custo isolado por empresa',async()=>{
        repository.criarCentroCusto.mockResolvedValue({id:1,codigo:'ADM'});
        await expect(service.criarCentroCusto(
            {codigo:'ADM',nome:'Administrativo'},
            {empresa_id:10}
        )).resolves.toEqual({id:1,codigo:'ADM'});
        expect(repository.criarCentroCusto).toHaveBeenCalledWith(
            expect.objectContaining({empresa_id:10})
        );
    });

    test('exige código do centro de custo',async()=>{
        await expect(service.criarCentroCusto(
            {nome:'Administrativo'},{empresa_id:10}
        )).rejects.toMatchObject({statusCode:400});
        expect(repository.criarCentroCusto).not.toHaveBeenCalled();
    });

    test('cria projeto isolado por empresa',async()=>{
        repository.criarProjeto.mockResolvedValue({id:2,codigo:'PROJ-01'});
        await expect(service.criarProjeto(
            {codigo:'PROJ-01',nome:'Nova loja'},{empresa_id:10}
        )).resolves.toEqual({id:2,codigo:'PROJ-01'});
        expect(repository.criarProjeto).toHaveBeenCalledWith(
            expect.objectContaining({empresa_id:10})
        );
    });

    test('lista projetos sempre pelo tenant',async()=>{
        repository.listarProjetos.mockResolvedValue([]);
        await expect(service.listarProjetos(
            {status:'ATIVO'},{empresa_id:99}
        )).resolves.toEqual([]);
        expect(repository.listarProjetos).toHaveBeenCalledWith({
            status:'ATIVO',empresa_id:99
        });
    });
});
