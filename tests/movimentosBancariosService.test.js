jest.mock('../src/repositories/movimentosBancariosRepository',()=>({criar:jest.fn(),buscarPorId:jest.fn(),listar:jest.fn(),marcarConciliado:jest.fn()}));
jest.mock('../src/repositories/contasBancariasRepository',()=>({buscarPorId:jest.fn()}));
jest.mock('../src/repositories/liquidacoesPagamentoRepository',()=>({buscarPorId:jest.fn()}));

const repository=require('../src/repositories/movimentosBancariosRepository');
const contasRepo=require('../src/repositories/contasBancariasRepository');
const liquidacoesRepo=require('../src/repositories/liquidacoesPagamentoRepository');
const service=require('../src/services/movimentosBancariosService');

describe('movimentosBancariosService',()=>{
 beforeEach(()=>jest.clearAllMocks());
 test('cria entrada em conta da mesma empresa',async()=>{
  contasRepo.buscarPorId.mockResolvedValue({id:1,status:'ATIVA'});
  repository.criar.mockResolvedValue({id:10,tipo:'ENTRADA'});
  await expect(service.criar({conta_bancaria_id:1,tipo:'ENTRADA',valor:100},{empresa_id:7,id:3}))
   .resolves.toEqual({id:10,tipo:'ENTRADA'});
  expect(repository.criar).toHaveBeenCalledWith(expect.objectContaining({empresa_id:7,valor:100,usuario_id:3}));
 });
 test('bloqueia conta de outro tenant',async()=>{
  contasRepo.buscarPorId.mockResolvedValue(null);
  await expect(service.criar({conta_bancaria_id:1,tipo:'SAIDA',valor:50},{empresa_id:8}))
   .rejects.toMatchObject({statusCode:404});
  expect(repository.criar).not.toHaveBeenCalled();
 });
 test('exige liquidação liquidada quando vinculada',async()=>{
  contasRepo.buscarPorId.mockResolvedValue({id:1,status:'ATIVA'});
  liquidacoesRepo.buscarPorId.mockResolvedValue({id:5,status:'PENDENTE'});
  await expect(service.criar({conta_bancaria_id:1,tipo:'SAIDA',valor:50,liquidacao_pagamento_id:5},{empresa_id:8}))
   .rejects.toMatchObject({statusCode:400});
  expect(repository.criar).not.toHaveBeenCalled();
 });
});
