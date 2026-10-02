const AppError=require('../errors/AppError');
const repository=require('../repositories/conciliacaoBancariaRepository');
const movimentosRepo=require('../repositories/movimentosBancariosRepository');

async function conciliar(dados,usuario){
 const movimentoId=Number(dados.movimento_bancario_id);
 if(!Number.isInteger(movimentoId)||movimentoId<=0) throw new AppError('Movimento bancário inválido',400);
 const movimento=await movimentosRepo.buscarPorId(movimentoId,usuario.empresa_id);
 if(!movimento) throw new AppError('Movimento bancário não encontrado',404);
 if(movimento.conciliado) throw new AppError('Movimento já conciliado',400);
 const existente=await repository.buscarPorMovimento(movimentoId,usuario.empresa_id);
 if(existente&&existente.status==='CONCILIADA') throw new AppError('Movimento já possui conciliação ativa',400);
 if(dados.valor_externo!=null && (!Number.isFinite(Number(dados.valor_externo))||Number(dados.valor_externo)<=0))
  throw new AppError('Valor externo inválido',400);
 const conciliacao=await repository.criar({...dados,empresa_id:usuario.empresa_id,usuario_id:usuario.id??null});
 await movimentosRepo.marcarConciliado(movimentoId,usuario.empresa_id);
 return conciliacao;
}
async function listar(filtros,usuario){return repository.listar(usuario.empresa_id,filtros);}
async function desfazer(id,usuario){
 const atual=await repository.listar(usuario.empresa_id,{});
 const alvo=atual.find(x=>x.id===Number(id));
 if(!alvo) throw new AppError('Conciliação não encontrada',404);
 return repository.desfazer(Number(id),usuario.empresa_id);
}
module.exports={conciliar,listar,desfazer};
