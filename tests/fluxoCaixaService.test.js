jest.mock('../src/repositories/fluxoCaixaRepository',()=>({resumo:jest.fn(),porDia:jest.fn(),previsao:jest.fn()}));
const repository=require('../src/repositories/fluxoCaixaRepository');
const service=require('../src/services/fluxoCaixaService');

describe('fluxoCaixaService',()=>{
 beforeEach(()=>jest.clearAllMocks());
 test('consolida fluxo pelo tenant e período',async()=>{
  repository.resumo.mockResolvedValue({entradas:'100',saidas:'40'});
  repository.porDia.mockResolvedValue([]);
  repository.previsao.mockResolvedValue([]);
  await expect(service.resumo({data_inicio:'2026-09-01',data_fim:'2026-09-30'},{empresa_id:10}))
   .resolves.toEqual({resumo:{entradas:'100',saidas:'40'},por_dia:[],previsao:[]});
  expect(repository.resumo).toHaveBeenCalledWith(10,{dataInicio:'2026-09-01',dataFim:'2026-09-30',contaBancariaId:undefined});
 });
 test('bloqueia período invertido',async()=>{
  await expect(service.resumo({data_inicio:'2026-09-30',data_fim:'2026-09-01'},{empresa_id:10}))
   .rejects.toMatchObject({statusCode:400});
  expect(repository.resumo).not.toHaveBeenCalled();
 });
});
