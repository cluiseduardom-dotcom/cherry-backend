jest.mock('../src/repositories/conciliacaoBancariaRepository',()=>({buscarPorId:jest.fn(),listar:jest.fn(),conciliarAtomico:jest.fn(),desfazerAtomico:jest.fn()}));
jest.mock('../src/repositories/movimentosBancariosRepository',()=>({buscarPorId:jest.fn()}));
const repository=require('../src/repositories/conciliacaoBancariaRepository');
const movimentosRepo=require('../src/repositories/movimentosBancariosRepository');
const service=require('../src/services/conciliacaoBancariaService');

describe('conciliacaoBancariaService',()=>{
 beforeEach(()=>jest.clearAllMocks());
 test('concilia movimento do mesmo tenant',async()=>{
  movimentosRepo.buscarPorId.mockResolvedValue({id:1,conciliado:false,cancelado_em:null});
  repository.conciliarAtomico.mockResolvedValue({id:9,status:'CONCILIADA'});
  await expect(service.conciliar({movimento_bancario_id:1,valor_externo:100},{empresa_id:10,id:2}))
   .resolves.toEqual({id:9,status:'CONCILIADA'});
  expect(repository.conciliarAtomico).toHaveBeenCalledWith(expect.objectContaining({empresa_id:10,movimento_bancario_id:1,usuario_id:2}));
 });
 test('bloqueia movimento de outro tenant',async()=>{
  movimentosRepo.buscarPorId.mockResolvedValue(null);
  await expect(service.conciliar({movimento_bancario_id:1},{empresa_id:99}))
   .rejects.toMatchObject({statusCode:404});
  expect(repository.conciliarAtomico).not.toHaveBeenCalled();
 });
 test('não concilia movimento já conciliado',async()=>{
  movimentosRepo.buscarPorId.mockResolvedValue({id:1,conciliado:true});
  await expect(service.conciliar({movimento_bancario_id:1},{empresa_id:10}))
   .rejects.toMatchObject({statusCode:400});
 });
 test('não concilia movimento cancelado',async()=>{
  movimentosRepo.buscarPorId.mockResolvedValue({id:1,conciliado:false,cancelado_em:'2026-11-01'});
  await expect(service.conciliar({movimento_bancario_id:1},{empresa_id:10}))
   .rejects.toMatchObject({statusCode:400});
  expect(repository.conciliarAtomico).not.toHaveBeenCalled();
 });
 test('quem perde a corrida recebe 409',async()=>{
  movimentosRepo.buscarPorId.mockResolvedValue({id:1,conciliado:false,cancelado_em:null});
  repository.conciliarAtomico.mockResolvedValue(null);
  await expect(service.conciliar({movimento_bancario_id:1},{empresa_id:10}))
   .rejects.toMatchObject({statusCode:409});
 });
 test('desfazer só vale para conciliação do próprio tenant',async()=>{
  repository.buscarPorId.mockResolvedValue(null);
  await expect(service.desfazer(5,{empresa_id:10})).rejects.toMatchObject({statusCode:404});
  expect(repository.desfazerAtomico).not.toHaveBeenCalled();
 });
});
