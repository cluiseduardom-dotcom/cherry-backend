jest.mock('../src/repositories/conciliacaoBancariaRepository',()=>({criar:jest.fn(),buscarPorMovimento:jest.fn(),listar:jest.fn(),desfazer:jest.fn()}));
jest.mock('../src/repositories/movimentosBancariosRepository',()=>({buscarPorId:jest.fn(),marcarConciliado:jest.fn()}));
const repository=require('../src/repositories/conciliacaoBancariaRepository');
const movimentosRepo=require('../src/repositories/movimentosBancariosRepository');
const service=require('../src/services/conciliacaoBancariaService');

describe('conciliacaoBancariaService',()=>{
 beforeEach(()=>jest.clearAllMocks());
 test('concilia movimento do mesmo tenant',async()=>{
  movimentosRepo.buscarPorId.mockResolvedValue({id:1,conciliado:false});
  repository.buscarPorMovimento.mockResolvedValue(null);
  repository.criar.mockResolvedValue({id:9,status:'CONCILIADA'});
  await expect(service.conciliar({movimento_bancario_id:1,valor_externo:100},{empresa_id:10,id:2}))
   .resolves.toEqual({id:9,status:'CONCILIADA'});
  expect(movimentosRepo.marcarConciliado).toHaveBeenCalledWith(1,10);
 });
 test('bloqueia movimento de outro tenant',async()=>{
  movimentosRepo.buscarPorId.mockResolvedValue(null);
  await expect(service.conciliar({movimento_bancario_id:1},{empresa_id:99}))
   .rejects.toMatchObject({statusCode:404});
 });
 test('não concilia movimento já conciliado',async()=>{
  movimentosRepo.buscarPorId.mockResolvedValue({id:1,conciliado:true});
  await expect(service.conciliar({movimento_bancario_id:1},{empresa_id:10}))
   .rejects.toMatchObject({statusCode:400});
 });
});
