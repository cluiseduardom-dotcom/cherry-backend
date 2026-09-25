const service=require('../services/fluxoCaixaService');
const response=require('../utils/response');
const AppError=require('../errors/AppError');

async function resumo(req,res,next){
 try{
  const hoje=new Date();
  const inicio=new Date(hoje.getFullYear(),hoje.getMonth(),1);
  const pad=(n)=>String(n).padStart(2,'0');
  const dataPadraoInicio=`${inicio.getFullYear()}-${pad(inicio.getMonth()+1)}-${pad(inicio.getDate())}`;
  const dataPadraoFim=`${hoje.getFullYear()}-${pad(hoje.getMonth()+1)}-${pad(hoje.getDate())}`;
  return response.success(res,await service.resumo({
   data_inicio:req.query.data_inicio??dataPadraoInicio,
   data_fim:req.query.data_fim??dataPadraoFim,
   conta_bancaria_id:req.query.conta_bancaria_id
  },req.usuario));
 }catch(error){next(error);}
}
module.exports={resumo};
