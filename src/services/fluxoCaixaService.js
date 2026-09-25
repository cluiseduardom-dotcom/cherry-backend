const AppError=require('../errors/AppError');
const repository=require('../repositories/fluxoCaixaRepository');

function validarData(valor,nome){
 if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(valor))) throw new AppError(`${nome} inválida`,400);
 return valor;
}
async function resumo(filtros,usuario){
 const dataInicio=validarData(filtros.data_inicio,'Data inicial');
 const dataFim=validarData(filtros.data_fim,'Data final');
 if(dataInicio>dataFim) throw new AppError('Período inválido',400);
 return {
  resumo:await repository.resumo(usuario.empresa_id,{dataInicio,dataFim,contaBancariaId:filtros.conta_bancaria_id}),
  por_dia:await repository.porDia(usuario.empresa_id,{dataInicio,dataFim,contaBancariaId:filtros.conta_bancaria_id}),
  previsao:await repository.previsao(usuario.empresa_id,{dataInicio,dataFim})
 };
}
module.exports={resumo};
