const service=require('../services/fluxoCaixaService');
const response=require('../utils/response');
const AppError=require('../errors/AppError');
const {hojeSP,inicioDoMesSP}=require('../utils/dataSaoPaulo');

async function resumo(req,res,next){
 try{
  const dataPadraoInicio=inicioDoMesSP();
  const dataPadraoFim=hojeSP();
  return response.success(res,await service.resumo({
   data_inicio:req.query.data_inicio??dataPadraoInicio,
   data_fim:req.query.data_fim??dataPadraoFim,
   conta_bancaria_id:req.query.conta_bancaria_id
  },req.usuario));
 }catch(error){next(error);}
}
module.exports={resumo};
